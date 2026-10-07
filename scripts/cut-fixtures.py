#!/usr/bin/env python3
"""Cuts test fixtures out of saved Card Kingdom pages.

Run locally, never in CI:

    python3 scripts/cut-fixtures.py --orders <saved order history.html> \
        --sales <saved selling history.html> --cart <saved sell cart.html> \
        --buy <saved buy cart.html> --prices <CK pricelist.json>

Each page given writes its own fixtures.

A saved page belongs to a signed-in account, so the fragment under test is
rebuilt rather than edited down: only allowlisted attributes survive, address
and tracking cells are replaced whole, every order id is renumbered wherever it
appears, every amount is replaced with a synthetic one of the same shape, and
the list's size (its results line and pager) is a synthetic one. Dates and
statuses stay as printed. A cart keeps CK's markup and none of the account's
items: each line is refilled with an item drawn at random (seeded) from a
price list, at that list's price, with line ids renumbered and every _token
replaced. The script then checks its own output for
anything it should have removed, and refuses to write if it finds one.
"""

import argparse
import html
import json
import os
import random
import re
import sys
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
KEEP = {"class", "id", "id-", "colspan", "role", "href", "aria-label", "method", "action", "name", "type", "value", "for", "selected", "alt", "data-ckproductid"}
SITE = "https://www.cardkingdom.com/"
MONEY = re.compile(r"\$[\d,]+\.\d{2}")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures")


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.kids = tag, attrs, parent, []

    def attr(self, name):
        return dict(self.attrs).get(name)


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.kids.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        open_ = self.cur
        while open_ is not None and open_.tag != tag:
            open_ = open_.parent
        if open_ is not None and open_.parent is not None:
            self.cur = open_.parent

    def handle_data(self, data):
        self.cur.kids.append(data)

    def handle_comment(self, data):
        self.cur.kids.append(Comment(data))


class Comment:
    """A comment; only Vue's empty placeholders are written back out."""

    def __init__(self, data):
        self.data = data


def parse(path):
    tree = Tree()
    with open(path, encoding="utf-8") as f:
        tree.feed(f.read())
    return tree.root


def walk(node):
    if isinstance(node, Node):
        yield node
        for kid in node.kids:
            yield from walk(kid)


def text(node):
    if isinstance(node, str):
        return node
    if isinstance(node, Comment):
        return ""
    return "".join(text(kid) for kid in node.kids)


def classed(node, name):
    return name in (node.attr("class") or "").split()


def only(nodes, what):
    nodes = list(nodes)
    if len(nodes) != 1:
        sys.exit(f"expected one {what}, found {len(nodes)}")
    return nodes[0]


class Renamer:
    """Maps every private value to a stand-in, the same one each time."""

    def __init__(self, first_id):
        self.first_id = first_id
        self.ids = {}
        self.amounts = {}

    def order(self, original):
        return self.ids.setdefault(original, str(self.first_id + len(self.ids)))

    def amount(self, original):
        if original not in self.amounts:
            # Same number of dollar digits, so the grouping shape survives.
            digits = len(re.sub(r"\D", "", original)) - 2
            n = len(self.amounts) + 1
            low = 10 ** (digits - 1) if digits > 1 else 0
            dollars = low + (n * 7919) % (10 ** digits - low)
            cents = (n * 53 + 7) % 100
            self.amounts[original] = f"${dollars:,}.{cents:02d}"
        return self.amounts[original]

    def apply(self, value):
        value = MONEY.sub(lambda m: self.amount(m.group(0)), value)
        for original, stand_in in self.ids.items():
            value = re.sub(r"\b" + original + r"\b", stand_in, value)
        return value


def history_rows(table):
    return [tr for tr in walk(table) if tr.tag == "tr" and any(isinstance(k, Node) and k.tag == "td" for k in tr.kids)]


def resize(nav, per, total):
    """Rewrites the results line and the pager for a list of total orders."""
    pages = -(-total // per)
    counts = [n for n in walk(nav) if classed(n, "resultsCount")]
    said = [text(n).strip() for n in counts]
    for n in counts:
        n.kids = [f"1 - {per} of {total} results"]
    final = only((n for n in walk(nav) if n.tag == "a" and n.attr("aria-label") == "Display Final Results Page"), "final page link")
    was = re.sub(r"\D", "", text(final))
    final.attrs = [(k, re.sub(r"page=\d+", f"page={pages}", v) if k == "href" else v) for k, v in final.attrs]
    final.kids = [f" {pages} "]
    picker = only((n for n in walk(nav) if n.tag == "ul" and classed(n, "page-picker-list")), "page picker")
    links = [n for n in picker.kids if isinstance(n, Node) and n.tag == "a"]
    picker.kids = [k for k in picker.kids if not (isinstance(k, Node) and k.tag == "a")]
    for i, link in enumerate(links[: max(pages - 3, 0)]):
        link.attrs = [(k, re.sub(r"page=\d+", f"page={i + 3}", v) if k == "href" else v) for k, v in link.attrs]
        only((n for n in link.kids if isinstance(n, Node) and n.tag == "li"), "picker entry").kids = [str(i + 3)]
        picker.kids += [" ", link]
    # What the original said, matched whole: its numbers alone also turn up in dates.
    return [line.split(" of ")[-1].join(["of ", ""]) for line in said] + [f'page={was}"', f">{was}<", f" {was} </a>"]


def cut_history(path, address_id, first_id, size):
    root = parse(path)
    wrapper = only((n for n in walk(root) if n.tag == "div" and classed(n, "orderHistoryWrapper")), "history wrapper")
    table = only((n for n in wrapper.kids if isinstance(n, Node) and n.tag == "table"), "history table")
    nav = only((n for n in wrapper.kids if isinstance(n, Node) and classed(n, "bottom-nav")), "bottom nav")
    names = Renamer(first_id)
    sizes = resize(nav, len(history_rows(table)), size)
    private = []

    for tr in history_rows(table):
        cell = only((n for n in walk(tr) if n.tag == "td" and n.attr("id") == "order_id"), "order id cell")
        names.order(text(cell).strip())
        address = only((n for n in walk(tr) if n.tag == "td" and n.attr("id") == address_id), "address cell")
        private += [line.strip() for line in text(address).split("\n") if line.strip()]
        address.kids = ["ADDRESS"]
        for link in (n for n in walk(tr) if n.tag == "a"):
            if not (link.attr("href") or "").startswith(SITE):
                link.attrs = [("href", "#")]
                link.kids = ["[track package]"]

    out = serialize(table, names) + serialize(nav, names)
    check(out, list(names.ids) + private + sizes)
    return out, names


def serialize(node, names):
    if isinstance(node, str):
        return html.escape(names.apply(node), quote=False)
    if isinstance(node, Comment):
        return "<!---->" if node.data == "" else ""
    attrs = "".join(
        f' {k}="{html.escape(names.apply(v or ""))}"' if v is not None else f" {k}"
        for k, v in node.attrs
        if k in KEEP
    )
    inner = "".join(serialize(kid, names) for kid in node.kids)
    if node.tag in VOID:
        return f"<{node.tag}{attrs}>"
    return f"<{node.tag}{attrs}>{inner}</{node.tag}>"


def check(out, private):
    leaks = [value for value in private if value and value in out]
    if "@" in out:
        leaks.append("an @")
    if re.search(r"\d{15,}", out):
        leaks.append("a 15-plus digit run")
    for host in re.findall(r'href="https?://([^/"]+)', out):
        if host != "www.cardkingdom.com":
            leaks.append("a link to " + host)
    if leaks:
        sys.exit("refusing to write, the cut still holds: " + "; ".join(sorted(set(leaks))[:5]))


# A cart fixture is CK's own markup with none of the account's items in it:
# each kept line is a saved line of the right shape, refilled with an item
# drawn at random (seeded) from a price list, at that item's price.
SEED = 20261007
SAVED_ITEMS = 2
RARITIES = "CURM"
CONDITIONS = ("NM", "EX", "VG", "G")

# The sell cart's lines: the saved line to take the markup from (by position
# on the saved cart), the quantity, and what the item drawn must be.
SELL_LINES = (
    (0, 1, "plain"),
    (1, 1, "foil"),
    (9, 3, "foil"),
    (12, 1, "cents"),
    (14, 4, "plain"),
    (21, 1, "colon"),
    (25, 1, "cents"),
    (26, 2, "variation"),
    (27, 1, "box"),
    (35, 1, "foil variation"),
)

# The buy cart's lines, all from its one saved line: a condition, a
# quantity, and what the item drawn must be.
BUY_LINES = (
    ("NM", 1, "plain"),
    ("EX", 1, "foil"),
    ("VG", 2, "plain"),
    ("G", 1, "cents"),
    ("NM", 3, "foil"),
    ("NM", 1, "colon"),
)

SELL_FORM = re.compile(r"(?:https://www\.cardkingdom\.com)?/sellcart/lineitem/(\d+)")
BUY_FORM = re.compile(r"(?:https://www\.cardkingdom\.com)?/cart/lineitem/(\d+)")


class Verbatim:
    """Writes text and attributes as they are; the cart is refilled beforehand."""

    def apply(self, value):
        return value


class CartNames:
    """Renumbers the ids in the cart's links and form actions."""

    def __init__(self):
        self.ids = {}

    def url(self, value):
        return re.sub(r"(?<=/)(\d{4,})(?=/|$|\?)", lambda m: self.ids.setdefault(m.group(1), str(1001 + len(self.ids))), value)


def cents(price):
    whole, _, frac = price.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def dollars(amount):
    return f"${amount // 100:,}.{amount % 100:02d}"


def alt(row):
    return (
        row["edition"] + (" Foil" if row["is_foil"] == "true" else "") + ": " + row["name"]
        + (f" ({row['variation']})" if row["variation"] else "")
    )


class Catalogue:
    """Draws items of a given shape from a price list, never the same one twice."""

    def __init__(self, path, avoid):
        with open(path, encoding="utf-8") as f:
            self.rows = sorted(json.load(f)["data"], key=lambda r: r["id"])
        self.rng = random.Random(SEED)
        self.used = {int(v) for v in avoid if v.isdigit()}
        self.names = {v for v in avoid if not v.isdigit()}

    def draw(self, shape, side, qty, condition="NM"):
        def fits(r):
            foil = r["is_foil"] == "true"
            if r["id"] in self.used or r["name"] in self.names or "Foil" in r["edition"].split() or ":" in r["name"]:
                return False
            if side == "sell":
                price, stock = cents(r["price_buy"]), r["qty_buying"]
            else:
                values = r["condition_values"]
                price, stock = cents(values[condition.lower() + "_price"]), values[condition.lower() + "_qty"]
            if price <= 0 or stock < qty or (shape != "box" and stock >= 100):
                return False
            return {
                "plain": not foil and not r["variation"] and price >= 100,
                "foil": foil and not r["variation"],
                # Retail never goes below 18 cents; buying goes down to 1.
                "cents": not foil and not r["variation"] and price <= (9 if side == "sell" else 25),
                "colon": not foil and ":" in r["variation"],
                "variation": not foil and r["variation"] and ":" not in r["variation"],
                "box": not foil and not r["variation"] and stock >= 100,
                "foil variation": foil and r["variation"],
            }[shape]

        row = self.rng.choice([r for r in self.rows if fits(r)])
        self.used.add(row["id"])
        return row


def refill(line, row, condition=None):
    """Puts another item in one saved line or saved item: its name, ids and links."""
    old = only({n.attr("alt") for n in walk(line) if n.tag == "img" and n.attr("alt")}, "card name")
    new = alt(row)
    foil = row["is_foil"] == "true"
    for node in walk(line):
        node.attrs = [(k, v.replace(old, new) if v else v) for k, v in node.attrs]
        if node.attr("data-ckproductid"):
            node.attrs = [(k, str(row["id"]) if k == "data-ckproductid" else v) for k, v in node.attrs]
        if node.tag == "a" and re.match(r"https://www\.cardkingdom\.com/mtg/", node.attr("href") or ""):
            node.attrs = [(k, "https://www.cardkingdom.com/" + row["url"] if k == "href" else v) for k, v in node.attrs]
        if classed(node, "card-border"):
            classes = [c for c in node.attr("class").split() if c != "is-foil"] + (["is-foil"] if foil else [])
            node.attrs = [(k, " ".join(classes) if k == "class" else v) for k, v in node.attrs]
        if classed(node, "title"):
            node.kids = [row["name"] + (f"\n({row['variation']})" if row["variation"] else "") + "\n"]
        if classed(node, "edition"):
            node.kids = [row["edition"] + (" Foil" if foil else "") + f" ({random.Random(row['id']).choice(RARITIES)})"]
        if classed(node, "style") and condition:
            node.kids = [condition]
        node.kids = [k for k in node.kids if foil or not (isinstance(k, Node) and classed(k, "foil"))]


def fill(line, row, qty, each, stock, condition=None):
    """Refills one saved line with another item, quantity and price."""
    refill(line, row, condition)
    price = only((n for n in walk(line) if classed(n, "item-price-wrapper")), "price")
    total = [n for n in walk(price) if classed(n, "cart-item-price")]
    each_box = only((n for n in walk(price) if n.tag == "small"), "price each")
    if total:
        total[0].kids = [f" {dollars(qty * each)} "]
        each_box.kids = [f" ({dollars(each)} /ea) "]
    else:
        price.kids = [f" {dollars(qty * each)} " if isinstance(k, str) and k.strip() and i == 0 else k for i, k in enumerate(price.kids)]
        each_box.kids = [f" {dollars(each)} /ea "]

    only((n for n in walk(line) if n.tag == "input" and n.attr("name") == "qty"), "quantity").attrs = [
        ("name", "qty"), ("type", "hidden"), ("class", "quantity"), ("value", str(qty))]
    for node in walk(line):
        if classed(node, "available"):
            node.kids = [f"({stock} available)" if stock >= 100 else f"(Max Qty: {stock})"]
        if node.tag == "input" and classed(node, "quantityBox"):
            node.attrs = [(k, str(qty) if k == "value" else v) for k, v in node.attrs]
        if classed(node, "dropdown-toggle"):
            node.kids = [f"{qty} "] + [k for k in node.kids if isinstance(k, Node)]
            node.attrs = [(k, re.sub(r"\d+$", str(qty), v) if k == "aria-label" else v) for k, v in node.attrs]
        if classed(node, "dropdown-menu"):
            node.attrs = [(k, re.sub(r"\d+$", str(stock), v) if k == "aria-label" else v) for k, v in node.attrs]
            first = only([n for n in node.kids if isinstance(n, Node) and n.tag == "button"][:1], "quantity option")
            node.kids = []
            for n in range(1, stock + 1):
                option = Node("button", [], node)
                option.attrs = [
                    (k, re.sub(r"\d+$", str(n), v) if k == "aria-label" else
                     ("true" if n == qty else "false") if k == "aria-selected" else
                     ("btn btn-default current" if n == qty else "btn btn-default") if k == "class" else v)
                    for k, v in first.attrs]
                option.kids = [str(n)]
                node.kids += [option, " "]


def wrappers(node):
    return [k for k in node.kids if isinstance(k, Node) and classed(k, "cart-item-wrapper")]


def keep_only(parent, kept):
    """Drops the wrappers not kept from parent, with the rule after each."""
    kids, dropping = [], False
    for kid in parent.kids:
        if isinstance(kid, Node) and classed(kid, "cart-item-wrapper"):
            dropping = kid not in kept
            if dropping:
                continue
        elif isinstance(kid, Node) and kid.tag == "hr" and dropping:
            dropping = False
            continue
        kids.append(kid)
    parent.kids = kids


def is_line(wrapper, form):
    return any(form.fullmatch(f.attr("action") or "") for f in walk(wrapper) if f.tag == "form")


def clone(node, parent):
    if not isinstance(node, Node):
        return node
    copy = Node(node.tag, list(node.attrs), parent)
    copy.kids = [clone(k, copy) for k in node.kids]
    return copy


def finish(items, lines, heading, private):
    """Recounts the header, renumbers ids, and writes the cart out checked."""
    qty = sum(int(only((n for n in walk(l) if n.tag == "input" and n.attr("name") == "qty"), "quantity").attr("value")) for l in lines)
    total = 0
    for line in lines:
        price = only((n for n in walk(line) if classed(n, "item-price-wrapper")), "price")
        shown = [n for n in walk(price) if classed(n, "cart-item-price")]
        total += cents(re.sub(r"[$,\s]", "", text(shown[0]) if shown else next(k for k in price.kids if isinstance(k, str) and k.strip())))
    only((n for n in walk(items) if n.tag == "h1" and re.match(heading, text(n))), "cart heading").kids = [f"{heading} ({qty} items)"]
    only((n for n in walk(items) if classed(n, "header-subtotal")), "subtotal").kids = [f"Subtotal: {dollars(total)} "]
    for node in list(walk(items)):
        node.kids = [k for k in node.kids if not (isinstance(k, Node) and (classed(k, "bottom-button-mobile") or classed(k, "bottom-button-desktop")))]

    names = CartNames()
    for node in walk(items):
        if node.tag == "input" and node.attr("name") == "_token":
            private.append(node.attr("value"))
            node.attrs = [(k, "TOKEN" if k == "value" else v) for k, v in node.attrs]
        node.attrs = [(k, names.url(v) if k in ("href", "action") and v else v) for k, v in node.attrs]
    out = serialize(items, Verbatim())
    numbers = [p for p in private + list(names.ids) if p.isdigit()]
    check(out, [p for p in private if not p.isdigit()])
    left = [n for n in numbers if re.search(r"\b" + n + r"\b", out)]
    if left:
        sys.exit("refusing to write, the cut still holds ids: " + ", ".join(left[:5]))
    return out


def originals(items):
    """Everything in a saved cart that names the account's items: card names,
    product ids and product links."""
    found = []
    for n in walk(items):
        found += [n.attr("alt") or "", n.attr("data-ckproductid") or ""]
        if classed(n, "title"):
            found.append(text(n).strip().split("\n")[0].strip())
        if n.tag == "a" and re.match(r"https://www\.cardkingdom\.com/mtg/", n.attr("href") or ""):
            found.append(n.attr("href"))
    return {f for f in found if f}


def cut_sell(path, catalogue):
    root = parse(path)
    items = only((n for n in walk(root) if n.tag == "div" and classed(n, "cartItemList")), "cart item list")
    private = sorted(originals(items), key=len, reverse=True)
    sell, saved = [n for n in walk(items) if classed(n, "cart-product-list")]

    lines = [w for w in wrappers(sell) if is_line(w, SELL_FORM)]
    kept = []
    for at, qty, shape in SELL_LINES:
        row = catalogue.draw(shape, "sell", qty)
        fill(lines[at], row, qty, cents(row["price_buy"]), row["qty_buying"])
        kept.append(lines[at])
    keep_only(sell, kept + [w for w in wrappers(sell) if not is_line(w, SELL_FORM)])

    shelf = [w for w in wrappers(saved) if any(n.tag == "img" for n in walk(w))][:SAVED_ITEMS]
    for item in shelf:
        row = catalogue.draw("plain", "buy", 1)
        refill(item, row)
        only((n for n in walk(item) if classed(n, "cart-item-price")), "saved price").kids = [f" {dollars(cents(row['price_retail']))} "]
    rest = [w for w in wrappers(saved) if not any(n.tag == "img" for n in walk(w))]
    for node in (n for w in rest for n in walk(w) if n.attr("data-ckproductid")):
        node.attrs = [(k, str(catalogue.draw("plain", "buy", 1)["id"]) if k == "data-ckproductid" else v) for k, v in node.attrs]
    keep_only(saved, shelf + rest)
    only((n for n in walk(saved) if n.tag == "h1"), "saved heading").kids = [f"Saved For Later ({SAVED_ITEMS} items)"]
    return finish(items, kept, "Sell Cart", private)


def cut_buy(path, catalogue):
    root = parse(path)
    items = only((n for n in walk(root) if n.tag == "div" and classed(n, "cartItemList")), "cart item list")
    private = sorted(originals(items), key=len, reverse=True)
    listing = only((n for n in walk(items) if classed(n, "cart-product-list")), "cart list")
    template = only((w for w in wrappers(listing) if is_line(w, BUY_FORM)), "buy line")
    rule = template.parent.kids[template.parent.kids.index(template) + 2]

    lines = []
    for i, (condition, qty, shape) in enumerate(BUY_LINES):
        row = catalogue.draw(shape, "buy", qty, condition)
        values = row["condition_values"]
        line = clone(template, listing)
        # Every copy of the one saved line needs a line id of its own.
        for node in walk(line):
            node.attrs = [(k, re.sub(r"/lineitem/\d+", f"/lineitem/{900000001 + i}", v) if k in ("href", "action") and v else v) for k, v in node.attrs]
        fill(line, row, qty, cents(values[condition.lower() + "_price"]), values[condition.lower() + "_qty"], condition)
        lines.append(line)
    at = listing.kids.index(template)
    spaced = [part for line in lines for part in (line, " ", clone(rule, listing), " ")]
    listing.kids[at:at + 3] = spaced[:-1]
    return finish(items, lines, "Cart", private)


def write(name, body, source, what):
    head = f"<!-- Cut by scripts/cut-fixtures.py from a saved {source} page. {what} -->\n"
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(head + body + "\n")
    print("wrote", name)


HISTORY = (
    "Order ids are\nrenumbered, amounts and the list's size are synthetic, addresses and tracking\n"
    "are replaced; dates and statuses are as printed."
)
CART = (
    "CK's markup with\nnone of the account's items: every line holds an item drawn at random from a\n"
    "price list, at that list's price; line ids renumbered, every _token replaced."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--orders", help="saved /myaccount/order_history page")
    ap.add_argument("--sales", help="saved /myaccount/selling_history page")
    ap.add_argument("--cart", help="saved /sellcart page")
    ap.add_argument("--buy", help="saved /cart page")
    ap.add_argument("--prices", help="a CK price list, to draw the carts' items from")
    args = ap.parse_args()
    if not (args.orders or args.sales or args.cart or args.buy):
        ap.error("give at least one saved page")
    if (args.cart or args.buy) and not args.prices:
        ap.error("a cart needs --prices to draw its items from")
    os.makedirs(OUT, exist_ok=True)

    wrap = lambda body: '<div class="orderHistoryWrapper">' + body + "</div>"
    if args.orders:
        orders, _ = cut_history(args.orders, "shipping_address", 1000001, 210)
        write("order-history.html", wrap(orders), "order history", HISTORY)
    if args.sales:
        sales, _ = cut_history(args.sales, "mailing_address", 2000001, 340)
        write("selling-history.html", wrap(sales), "selling history", HISTORY)
    if args.cart or args.buy:
        avoid = set()
        for saved in (args.cart, args.buy):
            if saved:
                avoid |= originals(parse(saved))
        catalogue = Catalogue(args.prices, avoid)
        if args.cart:
            write("sell-cart.html", cut_sell(args.cart, catalogue), "sell cart", CART)
        if args.buy:
            write("buy-cart.html", cut_buy(args.buy, catalogue), "buy cart", CART)


if __name__ == "__main__":
    main()
