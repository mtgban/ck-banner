# Fixtures

Cut by `scripts/cut-fixtures.py` from saved pages and a published price list;
see SPECIFICATIONS.md, section 14. None holds an account's own data.

| File | From | What is real, what is not |
|------|------|---------------------------|
| `order-history.html`, `selling-history.html` | saved history pages | CK's markup and statuses; order ids, amounts, dates and the list's size are synthetic |
| `sell-cart.html`, `buy-cart.html` | saved carts | CK's markup; every item is drawn from `pricelist.json`, at its price |
| `pricelist.json` | CK's 2026-09-17 price list | the rows of the items the carts hold, as published |

Tests that need a row the fixtures lack (another status, a price that moved)
edit a copy in the test and say so there.
