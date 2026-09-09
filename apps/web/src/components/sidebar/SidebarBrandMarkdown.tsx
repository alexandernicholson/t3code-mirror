import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * Inline formatting the sidebar title accepts. Everything else (links, images,
 * headings, lists, block HTML) is unwrapped to its plain text so the brand slot
 * can never grow past a single line of styled text.
 */
export const SIDEBAR_BRAND_ALLOWED_ELEMENTS = [
  "p",
  "strong",
  "b",
  "em",
  "i",
  "del",
  "s",
  "u",
  "ins",
  "code",
  "sub",
  "sup",
  "mark",
  "kbd",
] as const;

const SIDEBAR_BRAND_SANITIZE_SCHEMA = {
  tagNames: [...SIDEBAR_BRAND_ALLOWED_ELEMENTS],
  attributes: {},
  protocols: {},
  strip: ["script", "style"],
} satisfies Parameters<typeof rehypeSanitize>[0];

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, SIDEBAR_BRAND_SANITIZE_SCHEMA]] as NonNullable<
  Parameters<typeof ReactMarkdown>[0]["rehypePlugins"]
>;

// Paragraphs collapse into the inline flow so multiple lines read as one title.
const COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  code: ({ children }) => (
    <code className="rounded bg-foreground/10 px-1 font-mono text-[0.85em]">{children}</code>
  ),
  u: ({ children }) => <u className="underline underline-offset-2">{children}</u>,
  ins: ({ children }) => <u className="underline underline-offset-2">{children}</u>,
  mark: ({ children }) => (
    <mark className="rounded bg-primary/25 px-0.5 text-inherit">{children}</mark>
  ),
};

export const SidebarBrandMarkdown = memo(function SidebarBrandMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      allowedElements={[...SIDEBAR_BRAND_ALLOWED_ELEMENTS]}
      components={COMPONENTS}
      rehypePlugins={REHYPE_PLUGINS}
      remarkPlugins={REMARK_PLUGINS}
      skipHtml={false}
      unwrapDisallowed
    >
      {text}
    </ReactMarkdown>
  );
});
