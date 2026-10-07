# ck-banner specification

What the extension does, what it reads from Card Kingdom (CK), and the rules
it keeps. Every markup fact here was read from a saved CK page of a signed-in
account; the numbers in examples are made up.

The repository starts as a scaffold. Each section below lands with the step of
the build order (section 15) that implements it, and this file is kept true to
the code as it does.

## 1. What it is

Content scripts on www.cardkingdom.com, sharing a small panel fixed to the
bottom right of the page (the "CK BANner" heading, a mark, a drawn tooltip, one
row of buttons):

- **Sell cart** (`/sellcart`): compares every cart line with CK's price list and
  marks each line beside its *Save for Later* link. Where the list pays more,
  *Update price* asks CK to reprice the line.
- **Buy cart** (`/cart`): the same comparison the other way round, against the
  list's retail price for the line's condition. Where the list now charges
  less than the cart, a price reduction, the line is marked.
- **History** (`/myaccount/order_history`, `/myaccount/selling_history`): a
  year picker and *Download CSV*, writing every paid purchase that shipped or
  every paid sale that was completed.

Both carts work for a visitor who is not signed in. The history pages are
shown only to a signed-in account.

## 2. Where it runs

Manifest V3, no `permissions`, `host_permissions`, `background` or
`web_accessible_resources`; a test pins their absence. Each page has one
`matches` pattern with a trailing `*`, and the cart script returns at once
unless `location.pathname` is `/sellcart` or `/cart`, with or without a
trailing slash, so it never runs on the carts' form targets
(`/sellcart/lineitem/...`, `/cart/lineitem/...`, `/sellcart/empty_cart`).

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
routes end in `/purchase`, its prices are retail) and is ignored. Its *Move
All To Cart* button sits in a `.save-for-later-button` with a
`data-ckproductid` of its own, which is why a line is known by its quantity
form and not by a product id. A line that cannot be read whole (no product
id, quantity or price, a total that is not quantity times price, no card
name) is kept with the reason, so it can be marked rather than dropped.

### 3.2 Cash, not credit

The cart's prices are cash prices: the line totals add up to the Subtotal,
which equals the "w/ PayPal or Check" figure, and the store credit figure is
the Subtotal times 1.3. The price list's `price_buy` is cash too, so the two
compare directly.

### 3.3 The buy cart

The buy cart shares the sell cart's markup but for three things: its quantity
form posts to `/cart/lineitem/<id>`; the line total sits in
`span.cart-item-price` and the price each reads `($2.99 /ea)`; and each line
names its condition in `span.style` (`NM`, `EX`, `VG` or `G`). A line with any
other condition is unreadable. Its prices are retail for that condition, and
compare with the list's `condition_values` for it (`ex_price` for an EX line):
on a saved buy cart, an EX line matched `ex_price` to the cent.

## 4. The price list

`GET https://api.cardkingdom.com/api/v2/pricelist`, sent with
`credentials: "omit"` and no custom headers, so the request needs no preflight.
CK answers `access-control-allow-origin: *` and `cache-control: public,
max-age=300`. The body is `{"meta": {"created_at", "base_url"}, "data": [...]}`;
each row has `id`, `sku`, `scryfall_id`, `url`, `name`, `variation`,
`edition`, `is_foil` (the string `"true"` or `"false"`), `price_retail`,
`qty_retail`, `price_buy` (dollars as a string), `qty_buying`, and retail
`condition_values`.

The list is about 70 MB and 151,000 rows (the 2026-09-17 list). On arrival
it is reduced to arrays sorted by id, about 7 MB: `price_buy` in integer
cents and `qty_buying` for the sell cart; each condition's retail price and
quantity from `condition_values` for the buy cart; and a 32-bit key of the
card's name as the carts' images spell it (`Edition[ Foil]: Name[
(Variation)]`), which checks that a line's product id points at the card the
line shows. Prices must be plain dollars and at most two decimals. A row with
any field of another shape is skipped and counted, and an id listed twice is
dropped altogether, since which of its rows is right cannot be told. On the
2026-09-17 list every one of the 151,487 rows was kept, every name was
distinct and no two names shared a key; parsing and reducing took about a
quarter of a second in bun. A read that has not finished in two minutes fails. `created_at` is kept and shown, so a reader can tell "CK changed
the price" from "the list is older than the cart".

Singles only. Sealed lines are not compared until a saved cart with one has
been seen.

## 5. The one-hour cache

The reduced list is stored in IndexedDB on www.cardkingdom.com (no permission
needed), database `ck-banner`, store `cache`. It is fresh while less than an
hour old; at exactly an hour it is stale, and one dated in the future (the
clock moved back) is stale too. A stale or missing list is never used: the panel offers *Check prices*
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
| `qty_buying` is 0 | wants 0 | amber "Wants 0" |
| list pays more | better | *Update price* (section 7) |
| list pays less | worse | amber "List is lower" |
| equal | same | grey tick |

On the buy cart the same table runs the other way, against the list's price
and quantity for the line's condition:

| Condition | Verdict | Beside *Save for Later* |
|-----------|---------|-------------------------|
| a field unreadable (3.3) | unreadable | grey `?` |
| id not in the list | not listed | grey `?` |
| identity does not match the list row | mismatch | grey `?` |
| none in stock in that condition | none in stock | amber "None in stock" |
| list charges less | reduced | green "Price dropped" |
| list charges more | raised | amber "List is higher" |
| equal | same | grey tick |

A line's id must name the card its image shows: the list row's name key
(section 4) is checked against the line's `alt`, and a line whose id names
another card is not compared. Each mark is a badge placed first in the line's
*Save for Later* box, beside the link and never inside it, with a tooltip the
badge draws on hover or focus: the list's price each, the cart's, the
difference each and on the line's quantity, and when the list was built.
Every comparison is with a snapshot, and the tooltips say so; none of them
promises a checkout price.

The page is redrawn by Vue, so marking is idempotent: a line's old mark is
removed before its new one goes in, and an observer marks the cart again only
when its lines change or a redraw took a mark away, never because of its own
marks.

## 7. Update price

A *better* line on the sell cart carries *Update price* in place of a badge.
One click sends one request, for that line only:
`POST https://www.cardkingdom.com/api/sellcart/add` with the session cookie
and JSON `{"product_id": "<id>", "style": "NM", "quantity": q}`, the id a
string and q the line's current quantity: the request go-mtgban's CK cart
client sends. It carries no token. For a product already in the cart, whether
the request sets the quantity or adds to it, and whether it reprices the line,
is not known; CK's answer shows both, and the table below covers each outcome.

Before sending, the click checks that the list is still fresh and that the
line is still the line the button was made for (its line id and product id)
and still *better*. If not, nothing is sent and the line says "Check again".

CK's answer, not the cached list, says what happened. It is the whole cart;
the line is its one NM line for the product, read for `qty`, `price` and
`product.price_buy`.

| Answer for the line | Shown | Then |
|---------------------|-------|------|
| `qty` is q and `price` equals `product.price_buy` | green "Updated": "Card Kingdom now pays $X each" (and "not the $Y its list showed" when they differ) | the page reloads to show CK's own figures |
| `qty` is q, `price` is not `product.price_buy` | amber "Price kept": "Card Kingdom kept $Y each. Remove the card and add it again to take $X each." | nothing more is sent |
| `qty` is not q | red "Quantity changed" | q is put back through the line's own quantity form (`POST /sellcart/lineitem/<id>`, an absolute `qty` and the form's `_token`, as the cart page does), to the line id CK's answer names; then the page reloads |
| no single NM line for the product, not 200, not JSON, no answer | red "Not updated" with the reason | the panel says to reload; every other *Update price* stays disabled until then, since the cart may no longer be what the page shows |

While a request runs, every *Update price* and *Refresh* is disabled, the
page asks before it is left, and Escape does not stop it. Never: a delete, a
retry, a second request in flight, a request for a line whose verdict is not
*better*, or a request built from a control that no longer matches its line.

The buy cart has no such button; it marks a reduction and leaves the cart to
its owner. go-mtgban's client has the buy side's twin of the request,
`POST /api/cart/add` with the line's condition as `style`.

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
- Page 1 fixes the list's size: the total from `1 - 25 of N results`, the page
  size from the same line (25 unless the account chose otherwise), and a page
  count that must equal the final-page link where the page has one (a list of
  one page may not). Every later page must print its own range of that list
  (`26 - 50 of N`, and so on); if it does not, the list moved while it was
  read, and the export is refused.
- Every page holds exactly the rows its range says; a page with any other
  count, no table (a sign-in page, an error) or an order already listed
  refuses the export.
- A Cloudflare challenge stops the walk, keeps nothing, and says "Card Kingdom
  is checking the browser; reload and try again".
- Purchases may stop early once a page reaches an older year, provided every
  order read so far came newest first. Sales always read every page: their year is
  the Received date, which the order-date sort does not put in order.
- Escape cancels, and a page that arrives after it is dropped; a cancelled or
  refused walk writes nothing.

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

On the history pages the row is a year (All years, then this year back to
1999, the year CK opened; this year is chosen) and *Download CSV*. While the
walk runs the heading counts pages (`3 / 9 pages`). Done, it says how many
orders the file holds (`34 shipped`, `12 completed`) beside a tick, and the
tooltip names the file, the pages read, and what was left out by status,
unpaid, or year. Nothing to save is a red cross and no file. At these
addresses a page without the history table (a sign-in page) gets no panel.

On the carts the row is one button, *Check prices*, then *Refresh* once the
cart is marked; the list is read only on that click. While it reads the
heading says `reading list`. Done, the heading counts the lines the list now
favours (`3 better` on the sell cart, `2 dropped` on the buy cart, or `none`)
beside a tick, and the tooltip counts every verdict by name, what the better
prices would add (or the drops take off), when the list was built and read,
and, when the lines read do not come to the cart's Subtotal, that a line may
not have been read. A refused read is a red cross with the reason, and marks
already on the page stay. Escape stops a read and keeps nothing. A cart with
no lines gets no panel.

## 14. Fixtures

Fixtures are cut from saved pages by a local script and committed; the saved
pages never are. The cut rebuilds the fragment under test from an allowlist of
attributes, drops every script, event handler and Vue attribute, replaces each
`_token` with `TOKEN`, replaces the address and tracking cells whole, renumbers
every order and cart line id everywhere it appears (text, links, form actions,
labels), replaces every amount with a synthetic one of the same shape and the
list's size (its results line and pager) with a synthetic one, moves every
date to a synthetic one that keeps the page's order, and rewrites every URL
to a synthetic one on the same origin. Statuses stay as printed. A cart keeps
CK's markup and none of the account's items: each line is refilled with an
item drawn at random (seeded) from a price list, at that list's price for the
line's shape and condition, with line ids renumbered, every `_token`
replaced, and the item count and Subtotal recomputed. The
script checks its own output for an id, an address line or a link it should
have removed, and writes nothing if it finds one. `tests/repo.test.js` scans every
fixture for what a cut must never keep.

## 15. Build order

Each step is its own pull request off `master`:

1. Scaffold.
2. Shared pieces: money and dates, CSV writing, paced fetching.
3. Read a history page.
4. Walk the history pages, with the refusals of section 10.
5. The year picker and *Download CSV*.
6. Read the sell and buy carts.
7. Reduce and cache the price list.
8. Compare both carts with the list.
9. *Update price* on the sell cart.
10. The CSV cache.

Version 0.1.0 is released only after these have been checked on the live site,
in Chrome and Firefox: a real price list read from each cart page, signed in
and out; the history sort and a full sales walk under Cloudflare; a Vue
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
- Sealed lines in either cart.
- Whether CK reprices a buy cart line on its own.
