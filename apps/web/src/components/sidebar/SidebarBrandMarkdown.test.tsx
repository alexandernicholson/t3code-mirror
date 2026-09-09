import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

import { SidebarBrandMarkdown } from "./SidebarBrandMarkdown";

function render(text: string) {
  return renderToStaticMarkup(<SidebarBrandMarkdown text={text} />);
}

describe("SidebarBrandMarkdown", () => {
  it("renders inline emphasis, strikethrough, underline, and emoji", () => {
    const html = render("**Acme** _Labs_ ~~old~~ <u>new</u> `v2` 🚀");
    expect(html).toContain("<strong>Acme</strong>");
    expect(html).toContain("<em>Labs</em>");
    expect(html).toContain("<del>old</del>");
    expect(html).toContain("<u class");
    expect(html).toContain("new</u>");
    expect(html).toContain("v2</code>");
    expect(html).toContain("🚀");
    expect(html).not.toContain("<p");
  });

  it("flattens block syntax, links, and images to their text", () => {
    const html = render("# Big [site](https://example.com) ![alt](https://x/y.png)\n\n- item");
    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<ul");
    expect(html).toContain("Big ");
    expect(html).toContain("site");
    expect(html).toContain("item");
  });

  it("drops scripts, event handlers, and styling attributes", () => {
    const html = render('<script>alert(1)</script><b onclick="x()" style="color:red">hi</b>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("style=");
    expect(html).toContain("<b>hi</b>");
  });
});
