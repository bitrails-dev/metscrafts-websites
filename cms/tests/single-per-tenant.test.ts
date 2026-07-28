import assert from 'node:assert/strict'
import test from 'node:test'
import { singlePerTenant } from '../src/collections/utils/singlePerTenant'

type CountArgs = { collection?: unknown; where?: { tenant?: { equals?: unknown } } }

// A counting req that records its invocation. `totalDocs` controls the duplicate outcome.
const makeReq = (totalDocs: number) => {
  const calls: CountArgs[] = []
  const req = {
    payload: {
      count: async (args: CountArgs) => {
        calls.push(args)
        return { totalDocs }
      },
    },
  }
  return { req: req as never, calls }
}

// A req whose count() throws if reached — proves a path returns before counting.
const makeStrictReq = () =>
  ({
    payload: {
      count: async () => {
        throw new Error('count must not be called on this path')
      },
    },
  }) as never

const expect400 = async (fn: () => Promise<unknown>, messagePattern?: RegExp) => {
  try {
    await fn()
    assert.fail('expected the hook to reject with 400')
  } catch (err) {
    const error = err as { status?: number; message?: string }
    assert.equal(error.status, 400, `expected HTTP 400, got ${error.status}: ${error.message}`)
    if (messagePattern) assert.match(error.message ?? '', messagePattern)
  }
}

const run = (
  hook: ReturnType<typeof singlePerTenant>,
  args: { data: Record<string, unknown>; operation: 'create' | 'update'; req: never },
) => hook({ data: args.data, operation: args.operation, req: args.req } as never)

test('create without a tenant passes through without counting', async () => {
  const hook = singlePerTenant('commerce-settings')
  const data = { status: 'setup' }
  const result = await run(hook, { data, operation: 'create', req: makeStrictReq() })
  assert.equal(result, data)
})

test('the first create for a tenant is allowed (count === 0) and counts the slug', async () => {
  const hook = singlePerTenant('commerce-settings')
  const { req, calls } = makeReq(0)
  const data = { tenant: 7 }
  const result = await run(hook, { data, operation: 'create', req })
  assert.equal(result, data)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].collection, 'commerce-settings')
  assert.equal(calls[0].where?.tenant?.equals, 7)
})

test('a duplicate create for the same tenant throws 400', async () => {
  const hook = singlePerTenant('commerce-settings')
  const { req } = makeReq(1)
  await expect400(
    () => run(hook, { data: { tenant: 7 }, operation: 'create', req }),
    /already has a commerce-settings document/,
  )
})

test('update never counts and passes through', async () => {
  const hook = singlePerTenant('healthcare-settings')
  const data = { tenant: 7 }
  const result = await run(hook, { data, operation: 'update', req: makeStrictReq() })
  assert.equal(result, data)
})

test('a null or undefined tenant passes through without counting', async () => {
  const hook = singlePerTenant('commerce-settings')
  for (const tenant of [null, undefined]) {
    const data = { tenant }
    const result = await run(hook, { data, operation: 'create', req: makeStrictReq() })
    assert.equal(result, data)
  }
})

test('scalar tenant id and { id } relationship behave identically', async () => {
  const hook = singlePerTenant('healthcare-settings')

  // First create passes for both shapes; the count query resolves both to the scalar id 9.
  const scalarReq = makeReq(0)
  const scalarData = { tenant: 9 }
  assert.equal(await run(hook, { data: scalarData, operation: 'create', req: scalarReq.req }), scalarData)
  assert.equal(scalarReq.calls[0].where?.tenant?.equals, 9)

  const relReq = makeReq(0)
  const relData = { tenant: { id: 9 } }
  assert.equal(await run(hook, { data: relData, operation: 'create', req: relReq.req }), relData)
  assert.equal(relReq.calls[0].where?.tenant?.equals, 9)

  // Duplicate create throws identically for both shapes.
  await expect400(
    () => run(hook, { data: { tenant: 9 }, operation: 'create', req: makeReq(1).req }),
    /already has a healthcare-settings document/,
  )
  await expect400(
    () => run(hook, { data: { tenant: { id: 9 } }, operation: 'create', req: makeReq(1).req }),
    /already has a healthcare-settings document/,
  )
})
