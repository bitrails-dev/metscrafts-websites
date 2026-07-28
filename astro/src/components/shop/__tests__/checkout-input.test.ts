// Focused test (Wave E3) for the checkout input builder. Zero-dependency; asserts the exact
// shopApi.checkout input shape the CheckoutForm produces. Run with:
//   cms/node_modules/.bin/tsx src/components/shop/__tests__/checkout-input.test.ts
import { buildCheckoutInput, normalizePromotionCodes, checkoutReturnUrl } from "../checkout-input";
import { LOCALES, DEFAULT_LOCALE, localePath } from "../../../i18n";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e: any) {
    results.push({ name, ok: false, detail: e?.message ?? String(e) });
  }
}
function assert(cond: any, msg: string): void {
  if (!cond) throw new Error(msg);
}

check("normalizePromotionCodes trims, drops empties, dedups case-insensitively, caps at 10", () => {
  const out = normalizePromotionCodes(["  P10 ", "", "p10", "P20", "   ", "P30"]);
  assert(JSON.stringify(out) === '["P10","P20","P30"]', `got ${JSON.stringify(out)}`);
  const many = normalizePromotionCodes(Array.from({ length: 15 }, (_, i) => `C${i}`));
  assert(many.length === 10, `cap got ${many.length}`);
});

check("normalizePromotionCodes(undefined) → []", () => {
  assert(JSON.stringify(normalizePromotionCodes(undefined)) === "[]", "empty");
});

check("buildCheckoutInput builds the v2 shape and never sends items/totals", () => {
  // Build the returnUrl fixture from the catalogue so no locale literal appears in source.
  const secondary = LOCALES[1];
  const expectedReturn = `https://x${localePath("/checkout/confirmation", secondary)}`;
  const input = buildCheckoutInput({
    cartId: "cart-1",
    email: "a@b.com",
    phone: "0100",
    paymentMethod: "kashier",
    address: { fullName: "Sara", line1: "12 St", city: "Cairo", governorate: "Cairo", postalCode: "1", country: "EG" },
    promotionCodes: ["P10", "p10", "P20"],
    giftCardCode: "  GC1  ",
    shippingMethodId: "sm-1",
    idempotencyKey: "idem-9",
    returnUrl: expectedReturn,
  });
  assert(input.cartId === "cart-1", "cartId");
  assert(input.paymentMethod === "kashier", "paymentMethod");
  // Email + phone ride on the shipping address block (guest checkout contact).
  assert((input.shippingAddress as any).email === "a@b.com", "email on address");
  assert((input.shippingAddress as any).phone === "0100", "phone on address");
  assert((input.shippingAddress as any).city === "Cairo", "city");
  assert((input.shippingAddress as any).country === "EG", "country");
  assert(JSON.stringify(input.promotionCodes) === '["P10","P20"]', `promo ${JSON.stringify(input.promotionCodes)}`);
  assert(input.giftCardCode === "GC1", "giftCard trimmed");
  assert(input.shippingMethodId === "sm-1", "shippingMethodId");
  assert(input.idempotencyKey === "idem-9", "idempotencyKey");
  assert(input.returnUrl === expectedReturn, "returnUrl");
  assert(!("items" in input), "must not send items");
  assert(!("amountDue" in input), "must not send amountDue");
});

check("buildCheckoutInput omits optional fields when not provided", () => {
  const input = buildCheckoutInput({
    cartId: "c",
    email: "a@b.com",
    paymentMethod: "cod",
    address: { line1: "x", city: "Cairo" },
  });
  assert(!("promotionCodes" in input), "no promo");
  assert(!("giftCardCode" in input), "no gc");
  assert(!("shippingMethodId" in input), "no shipping method");
  assert(!("idempotencyKey" in input), "no idem");
  assert(!("returnUrl" in input), "no returnUrl");
});

check("buildCheckoutInput throws when cartId is missing", () => {
  let threw = false;
  try {
    buildCheckoutInput({ cartId: "", email: "a@b.com", paymentMethod: "cod", address: {} });
  } catch {
    threw = true;
  }
  assert(threw, "should throw on missing cartId");
});

check("checkoutReturnUrl prefixes the non-default locale, none for the default", () => {
  // window is undefined under tsx; the helper falls back to empty origin — we only assert the path.
  const secondary = LOCALES[1];
  assert(checkoutReturnUrl(secondary) === localePath("/checkout/confirmation", secondary), `secondary: ${checkoutReturnUrl(secondary)}`);
  assert(checkoutReturnUrl(DEFAULT_LOCALE) === localePath("/checkout/confirmation", DEFAULT_LOCALE), `default: ${checkoutReturnUrl(DEFAULT_LOCALE)}`);
});

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.name}${r.ok ? "" : " — " + r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checkout-input assertions passed.`);
if (failed.length) throw new Error(`${failed.length} checkout-input assertion(s) failed`);
