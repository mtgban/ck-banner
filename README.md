# ck-banner

**CK BANner** is a browser extension for Card Kingdom. It does two things:

- **On the sell cart** (`/sellcart`) it checks every line against Card
  Kingdom's public price list and says, next to the line's *Save for Later*,
  whether the list pays more or less than the cart. Where the list pays more,
  *Update price* asks Card Kingdom to reprice that line. The list is read once
  on a click and kept for an hour.
- **On the buy cart** (`/cart`) it does the same the other way round: each line
  is checked against the list's price for its condition, and a line the list
  now sells for less is marked as a price drop. Both carts work signed out.
- **On order and selling history** (`/myaccount/order_history`,
  `/myaccount/selling_history`) you pick a year and download a CSV of every
  paid purchase that shipped, or every paid sale that was completed, one row
  per order in five columns: Order ID, Order Status, Order Date, Completed on
  and Amount. The file is kept, so asking again while the history has not
  changed downloads it at once.

It is in development, and the features land in the order `SPECIFICATIONS.md`
gives.

## Permissions

None. The price list allows any site to read it, and everything else the
extension reads or sends goes to the Card Kingdom page it is running on, as
the signed-in user. On a click it reads the price list (no cookies sent); on
the history pages it reads the history's own pages one at a time; *Update
price* sends one request per click. Nothing leaves your browser for anywhere
else.

## Installing it

The same unpacked folder works in all three browsers.

**Chrome** - `chrome://extensions`, turn on Developer mode, *Load unpacked*,
pick this folder.

**Firefox** - `about:debugging#/runtime/this-firefox`, *Load Temporary Add-on*,
pick `manifest.json`. Firefox drops a temporary add-on when it restarts, so
this needs redoing each session.

**Safari** - Safari runs the same extension but wants an app around it, which
needs Xcode:

```
xcrun safari-web-extension-converter .
```

Run the generated project once, then enable the extension in Safari's settings.
For an unsigned build, Safari's Develop menu has to have *Allow Unsigned
Extensions* turned on, which Safari resets when it quits.

## Developing

```
bun install
bun test tests/
```

Read `AGENTS.md` before changing anything.
