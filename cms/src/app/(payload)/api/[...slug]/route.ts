import config from '@payload-config'
import {
  REST_DELETE,
  REST_GET,
  REST_OPTIONS,
  REST_PATCH,
  REST_POST,
  REST_PUT,
} from '@payloadcms/next/routes'

type PayloadRoute = (
  request: Request,
  args: { params: Promise<{ slug?: string[] }> },
) => Promise<Response>

// Payload handles expected APIError/ValidationError instances itself. This final boundary is for
// unexpected hook, adapter, or serialization failures: log the real error, return JSON to the
// browser, and keep the Next dev process alive instead of allowing an uncaught route exception to
// bubble into the dev server.
const withRouteErrorBoundary = (handler: PayloadRoute): PayloadRoute => async (request, args) => {
  try {
    return await handler(request, args)
  } catch (error) {
    console.error('Unhandled Payload API error', error)
    return Response.json(
      { errors: [{ message: 'An unexpected server error occurred.' }] },
      { status: 500 },
    )
  }
}

export const GET = withRouteErrorBoundary(REST_GET(config))
export const POST = withRouteErrorBoundary(REST_POST(config))
export const DELETE = withRouteErrorBoundary(REST_DELETE(config))
export const PATCH = withRouteErrorBoundary(REST_PATCH(config))
export const PUT = withRouteErrorBoundary(REST_PUT(config))
export const OPTIONS = withRouteErrorBoundary(REST_OPTIONS(config))
