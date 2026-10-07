# ck-banner specification

What the extension does, what it reads from Card Kingdom (CK), and the rules
it keeps. Every markup fact here was read from a saved CK page of a signed-in
account; the numbers in examples are made up.

The repository starts as a scaffold. Each section below lands with the step of
the build order (section 15) that implements it, and this file is kept true to
the code as it does.

## 1. What it is

Two content scripts on www.cardkingdom.com, sharing a small panel fixed to the
bottom right of the page (the "CK BANner" heading, a mark, a drawn tooltip, one
row of buttons):

- **Sell cart** (`/sellcart`): compares every cart line with CK's price list and
  marks each line beside its *Save for Later* link. Where the list pays more,
  *Update price* asks CK to reprice the line.
- **History** (`/myaccount/order_history`, `/myaccount/selling_history`): a
  year picker and *Download CSV*, writing every paid purchase that shipped or
  every paid sale that was completed.

## 2. Where it runs

Manifest V3, no `permissions`, `host_permissions`, `background` or
`web_accessible_resources`; a test pins their absence. Each page has one
`matches` pattern with a trailing `*`, and the cart script returns at once
unless `location.pathname` is `/sellcart` or `/sellcart/`, so it never runs on
the cart's form targets (`/sellcart/lineitem/...`, `/sellcart/empty_cart`).

## 3. The sell cart

### 3.1 Reading a line

Lines are `div.row.cart-item-wrapper` elements that hold a sell-cart quantity
form. For each:

| Field | Where |
|-------|-------|
| product id | `.save-for-later-button a[data-ckproductid]`, the same id as the price list's `id` |
| line id | the quantity form's action, read with `new URL(action, location.href)`; the pathname must be `/sellcart/lineitem/<digits>` (actions appear both relative and absolute) |
| quantity | that form's hidden `input[name="qty"]`, never the visible dropdown (lines with 100 or more available show a text box instead) |
| price each | `.item-price-wrapper small`, text `$1.50 /ea` |
| line total | the text before the `<br>` in `.item-price-wrapper`; it must equal quantity x price each, or the line is unreadable |
| identity | the first `img[alt]`: `Edition[ Foil]: Name[ (Variation)]`, which equals the price list's `edition`, `is_foil`, `name` and `variation` for the line's id |

Every field comes from the same wrapper, or the line is unreadable.

The *Saved For Later* section under the cart belongs to the purchase side (its
routes end in `/purchase`, its prices are retail) and is ignored.

### 3.2 Cash, not credit

The cart's prices are cash prices: the line totals add up to the Subtotal,
which equals the "w/ PayPal or Check" figure, and the store credit figure is
the Subtotal times 1.3. The price list's `price_buy` is cash too, so the two
compare directly.

## 4. The price list

`GET https://api.cardkingdom.com/api/v2/pricelist`, sent with
`credentials: "omit"` and no custom headers, so the request needs no preflight.
CK answers `access-control-allow-origin: *` and `cache-control: public,
max-age=300`. The body is `{"meta": {"created_at", "base_url"}, "data": [...]}`;
each row has `id`, `sku`, `scryfall_id`, `url`, `name`, `variation`,
`edition`, `is_foil` (the string `"true"` or `"false"`), `price_retail`,
`qty_retail`, `price_buy` (dollars as a string), `qty_buying`, and retail
`condition_values`.

The list is about 94 MB and 146,000 rows. On arrival it is reduced to three
arrays sorted by id: id, `price_buy` in integer cents (a price that is not
plain dollars and cents is skipped and counted), and `qty_buying`. That is
about 2 MB. `created_at` is kept and shown, so a reader can tell "CK changed
the price" from "the list is older than the cart".

Singles only. Sealed lines are not compared until a saved cart with one has
been seen.

## 5. The one-hour cache

The reduced list is stored in IndexedDB on www.cardkingdom.com (no permission
needed). It is fresh while less than an hour old; at exactly an hour it is
stale. A stale or missing list is never used: the panel offers *Check prices*
and marks nothing. An entry of the wrong shape or schema version counts as
missing. Where IndexedDB is unavailable (some private windows), the list is
held for the page's life and the tooltip says so.

## 6. Verdicts

First match wins:

| Condition | Verdict | Beside *Save for Later* |
|-----------|---------|-------------------------|
| a field unreadable (3.1) | unreadable | grey `?` |
| id not in the list | not listed | grey `?` |
| identity does not match the list row | mismatch | grey `?` |
| `qty_buying` is 0 | wants 0 | amber `!` "Wants 0" |
| list pays more | better | *Update price* |
| list pays less | worse | amber `!` "List is lower" |
| equal | same | grey tick |

Every comparison is with a snapshot, and the tooltips say so ("Card Kingdom's
price list, built 04:05"); none of them promises a checkout price. The panel's
tooltip sums the lines: how many are better, worse and the same, and the
difference in dollars.

## 7. Update price

One request per click, for one *better* line, while the list is fresh:
`POST https://www.cardkingdom.com/api/sellcart/add` with JSON
`{"product_id": ..., "style": "NM", "quantity": q}`, q being the line's
current quantity. go-mtgban's CK cart client sends the same request. For a
product already in the cart, whether it sets the quantity or adds to it, and
whether it reprices the line, is not known; the response shows both, and the
table below covers each outcome. CK's own cart page changes a quantity through
the line's form instead (`POST /sellcart/lineitem/<id>` with an absolute
`qty`), which is how a wrong quantity is put back.

CK's response, not the cached list, says what happened. It is the whole cart:
per line `product_id`, `style`, `qty`, `price`, `original_price` and
`product.price_buy`.

| Response for the line | Shown | Then |
|-----------------------|-------|------|
| `qty` is q and `price` equals `product.price_buy` | tick, "Card Kingdom now pays $X each" | reload the page |
| `qty` is q, `price` unchanged | amber `!`, "Card Kingdom kept $Y. Remove the card and add it again to take $X." | nothing was changed |
| `qty` is not q | red cross, the quantity CK set | the line's own quantity form puts it back to q, then reload |
| no line, not 200, not JSON | red cross, the reason | reload to show what CK holds |

Never: a delete, a retry loop, more than one request in flight (every *Update
price* is disabled while one runs), a request for a line whose verdict is not
*better*, or a request built from a control that no longer matches its line.

## 8. The history pages

Both pages hold `div.orderHistoryWrapper table`, 25 rows a page, newest order
first, paged with `?page=N`. Page 1 also prints `1 - 25 of N results`, and the
pager's last link has `aria-label="Display Final Results Page"`.

The header is a row of `th` inside `tbody`. Columns are found by their header
text: `Order ID`, `Order Date`, `Payment Method`, `Status`, `Total`, and a
second column called `Ship To` (purchases) or `Mailing Address` (sales). The
address column is never read. A page missing any of these headers is refused.

| Cell | Purchases | Sales |
|------|-----------|-------|
| order id | link to `/myaccount/invoice/<id>` | link to `/myaccount/po_invoice/<id>` |
| order date | `Mar 14, 2026 10:36 AM` | same shape |
| payment | method lines, then `Paid <date>` | method, then `Paid` or `Unpaid` |
| status | `SHIPPED`, then `Shipped <date time>` and a tracking link | `COMPLETED`, then `Received <date>`; the cell's attribute is spelled `id-=` |
| total | `$123.45` | same |

Dates are parsed with a month table and arithmetic, never `Date.parse`; an
unknown shape refuses the page and names the order.

## 9. Which rows, and which year

A purchase is exported when its status is exactly `SHIPPED` and it is Paid; a
sale when its status is exactly `COMPLETED` and it is Paid. Every other row is
skipped and counted by status in the tooltip, so an unfamiliar status is
reported, not silently dropped.

The year of a purchase is its order date's; the year of a sale is its Received
date's. A completed sale with no Received date refuses the export.

## 10. The walk

- One page at a time, a pause of 1.2 s before each after the first, from
  page 1 whatever page is open. A page that has not answered in 30 s fails
  the walk.
- Page 1 fixes the list's geometry: the total from `of N results`, 25 a page,
  and a page count that must equal both the final-page link and
  `ceil(total / 25)`. Every later page must report the same; if it does not,
  the list moved while it was read, and the export is refused.
- Every page but the last holds exactly 25 rows and the last holds the rest; a
  page with any other count, no table (a sign-in page, an error) or a duplicate
  order id refuses the export.
- A Cloudflare challenge stops the walk, keeps nothing, and says "Card Kingdom
  is checking the browser; reload and try again".
- Purchases may stop early once a page reaches an older year, provided that
  page's order dates never go up. Sales always read every page: their year is
  the Received date, which the order-date sort does not put in order.
- Escape cancels; a cancelled or refused walk writes nothing.

## 11. The CSV

Five columns whose header is a contract, since spreadsheets built on the file
read them by name:

| Column | Purchases | Sales |
|--------|-----------|-------|
| `Order ID` | order id | order id |
| `Order Status` | `SHIPPED` | `COMPLETED` |
| `Order Date` | as printed | as printed |
| `Completed on` | the Shipped date, as printed | the Received date, as printed |
| `Amount` | as printed (`$123.45`) | as printed |

Named `ck-purchases-<year>.csv` or `ck-sales-<year>.csv` (`all` for every
year), rows in CK's order. The bytes are what Go's `csv.Writer` writes for the
same rows: a value is quoted only when it holds a comma, a quote or a line
break, a quote is doubled, and every row ends in LF. No address and
nothing from a tracking link.

## 12. The CSV cache

A finished file is kept in IndexedDB, keyed by account (a hash of what the
signed-in page shows, never stored in the clear), page, year and CSV version,
together with the history's signature when it was built: the total and every
row of page 1 (order id, status, status date, payment). On *Download CSV*, an
unchanged signature downloads the kept file at once; a changed one walks again
and replaces it. A failed walk never replaces a good file. *Rebuild* always
walks, and the current year's file expires after a day, since a change deeper
than page 1 does not move the signature.

## 13. The panel

A fixed width that never changes while it works. Status is a mark beside the
heading's count (a tick, a red cross) with the reason on a tooltip the panel
draws itself; nothing is written under the buttons, and nothing carries a
`title`. Escape stops whatever is running. While a read runs the page asks
before it is left.

## 14. Fixtures

Fixtures are cut from saved pages by a local script and committed; the saved
pages never are. The cut rebuilds the fragment under test from an allowlist of
attributes, drops every script, event handler and Vue attribute, replaces each
`_token` with `TOKEN`, replaces the address and tracking cells whole, renumbers
every order and cart line id everywhere it appears (text, links, form actions,
labels), and rewrites every URL to a synthetic one on the same origin. Product
ids stay: they are CK's public catalogue ids. `tests/repo.test.js` scans every
fixture for what a cut must never keep.

## 15. Build order

Each step is its own pull request off `master`:

1. Scaffold.
2. Shared pieces: money and dates, CSV writing, paced fetching.
3. Read a history page.
4. Walk the history pages, with the refusals of section 10.
5. The year picker and *Download CSV*.
6. Read the sell cart.
7. Reduce and cache the price list.
8. Compare the cart with the list.
9. *Update price*.
10. The CSV cache.

Version 0.1.0 is released only after these have been checked on the live site,
in Chrome and Firefox: a real price list read from the cart page; the history
sort, the signed-out response, and a full sales walk under Cloudflare; a Vue
re-render re-marking each line once and never the wrong one; IndexedDB from
the content script; the cart reached by every route; and *Update price* on a
cheap card while the account's owner watches.

## 16. Not yet known

- What the add request does to a product already in the cart: whether it sets
  the quantity or adds to it, and whether it reprices the line or only removing
  and re-adding does. Section 7's response handling covers each case.
- How often the price list is rebuilt (`created_at`), and so how often it is
  older than the cart.
- What the history pages' 25 / 50 / 100 page-size choice does; the walk uses
  25 until that is known.
- Sealed lines in the sell cart.
