#!/usr/bin/env python3
"""Cuts test fixtures out of saved Card Kingdom pages.

Run locally, never in CI:

    python3 scripts/cut-fixtures.py --orders <saved order history.html> \
        --sales <saved selling history.html>

A saved page belongs to a signed-in account, so the fragment under test is
rebuilt rather than edited down: only allowlisted attributes survive, address
and tracking cells are replaced whole, every order id is renumbered wherever it
appears, and every amount is replaced with a synthetic one of the same shape.
Dates and statuses stay as printed. The script then checks its own output for
anything it should have removed, and refuses to write if it finds one.
"""

import argparse
import html
import os
import re
import sys
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
KEEP = {"class", "id", "id-", "colspan", "role", "href", "aria-label", "method", "action", "name", "type", "value"}
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


def cut_history(path, address_id, first_id):
    root = parse(path)
    wrapper = only((n for n in walk(root) if n.tag == "div" and classed(n, "orderHistoryWrapper")), "history wrapper")
    table = only((n for n in wrapper.kids if isinstance(n, Node) and n.tag == "table"), "history table")
    names = Renamer(first_id)
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

    out = serialize(table, names)
    check(out, list(names.ids) + private)
    return out, names


def serialize(node, names):
    if isinstance(node, str):
        return html.escape(names.apply(node), quote=False)
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


def write(name, body, source):
    head = (
        f"<!-- Cut by scripts/cut-fixtures.py from a saved {source} page. Order ids are\n"
        "renumbered, amounts are synthetic, addresses and tracking are replaced; dates\n"
        "and statuses are as printed. -->\n"
    )
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(head + '<div class="orderHistoryWrapper">' + body + "</div>\n")
    print("wrote", name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--orders", required=True, help="saved /myaccount/order_history page")
    ap.add_argument("--sales", required=True, help="saved /myaccount/selling_history page")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    orders, _ = cut_history(args.orders, "shipping_address", 1000001)
    sales, _ = cut_history(args.sales, "mailing_address", 2000001)
    write("order-history.html", orders, "order history")
    write("selling-history.html", sales, "selling history")


if __name__ == "__main__":
    main()
