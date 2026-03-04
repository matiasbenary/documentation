#!/usr/bin/env node
/**
 * Migrates Docusaurus markdown files to Mintlify format.
 *
 * Transforms:
 *  - $NEAR in prose → `$NEAR` (avoids LaTeX rendering)
 *  - <blockquote className="lesson"> → <Tip> (with <strong>, <br/>, <a> converted)
 *  - :::tip/note/info/warning/danger → <Tip>/<Note>/<Info>/<Warning>/<Danger> (title → **bold**)
 *  - <Tip title="...">, <Info title="...">, etc. → title converted to **bold** inside callout
 *  - <details>/<summary> → <Accordion title="...">
 *  - <hr class="subsection" /> → removed
 *  - Fenced code blocks with no language → ```text
 *  - Frontmatter: removes (id, sidebar_position, slug), converts sidebar_label → sidebarTitle
 *  - Internal links: strips .md extension
 *  - <CodeTabs>/<Language> → <CodeGroup>
 *  - GFM footnotes [^N] / [^N]: → <sup> inline refs + ## References list
 *
 * Usage:
 *   node migrate-to-mintlify.js [dir]        # default: list Docusaurus imports
 *   node migrate-to-mintlify.js [dir] --fix  # transform + rename .md → .mdx
 */

const fs = require('fs');
const path = require('path');

const COMPONENT_MAP = {
  tip: 'Tip',
  note: 'Note',
  info: 'Info',
  warning: 'Warning',
  caution: 'Warning',
  danger: 'Danger',
};

// ---------------------------------------------------------------------------
// Split content into segments: { code: bool, text: string }
// Tracks fenced code blocks (``` ... ```) so transforms skip them.
// ---------------------------------------------------------------------------
function splitFenced(content) {
  const segments = [];
  const lines = content.split('\n');
  let inCode = false;
  let buf = [];

  for (const line of lines) {
    const isOpenFence = !inCode && /^```/.test(line);
    const isCloseFence = inCode && /^```\s*$/.test(line);

    if (isOpenFence) {
      if (buf.length) segments.push({ code: false, text: buf.join('\n') });
      buf = [line];
      inCode = true;
    } else if (isCloseFence) {
      buf.push(line);
      segments.push({ code: true, text: buf.join('\n') });
      buf = [];
      inCode = false;
    } else {
      buf.push(line);
    }
  }

  if (buf.length) segments.push({ code: inCode, text: buf.join('\n') });
  return segments;
}

function applyOutsideFenced(content, fn) {
  return splitFenced(content)
    .map(s => (s.code ? s.text : fn(s.text)))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

/** Remove <hr class="subsection" /> lines */
function fixSubsectionHr(text) {
  return text.replace(/<hr\s+class=["']subsection["']\s*\/?>/g, '');
}

/** :::tip Title ... ::: → <Tip>\n**Title**\n...</Tip> */
function fixAdmonitions(text) {
  // (?=\n|$) prevents the closing \n::: from consuming the opening ::: of the
  // next admonition when two admonitions are immediately consecutive.
  return text.replace(
    /:::(\w+)([ \t]+[^\n]*)?\n([\s\S]*?)\n:::(?=\n|$)/g,
    (_, type, title, body) => {
      const comp = COMPONENT_MAP[type.toLowerCase()] || 'Note';
      const titleLine = title?.trim() ? `**${title.trim()}**\n` : '';
      return `<${comp}>\n${titleLine}${body}\n</${comp}>`;
    }
  );
}

/** <blockquote className="lesson">...<strong>Q</strong><br/><br/>A...</blockquote> → <Tip>**Q**\n\nA</Tip> */
function fixLessonBlockquotes(text) {
  return text.replace(
    /<blockquote\s+className=["']lesson["']>([\s\S]*?)<\/blockquote>/g,
    (_, body) => {
      let content = body.trim();
      content = content.replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**');
      content = content.replace(/<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)');
      content = content.replace(/<br\s*\/><br\s*\/>/g, '\n\n');
      content = content.replace(/<br\s*\/>/g, '\n');
      return `<Tip>\n${content}\n</Tip>`;
    }
  );
}

/** <Tip title="...">, <Info title="...">, etc. → <Tip>\n**...**\n... */
function fixCalloutTitles(text) {
  const callouts = Object.values(COMPONENT_MAP).join('|');
  return text.replace(
    new RegExp(`<(${callouts})\\s+title=["']([^"']+)["']([^>]*)>`, 'g'),
    (_, comp, title, rest) => `<${comp}${rest}>\n**${title}**`
  );
}

/** <details ...>\n<summary>Title</summary>...\n</details> → <Accordion title="Title">...</Accordion> */
function fixDetails(text) {
  return text.replace(
    /<details[^>]*>\s*\n\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g,
    (_, title, body) => `<Accordion title="${title.trim()}">${body}</Accordion>`
  );
}

/** Fenced code blocks without a language specifier → ```text */
function fixBareFences(content) {
  return splitFenced(content)
    .map(s => {
      if (!s.code) return s.text;
      const lines = s.text.split('\n');
      if (/^```\s*$/.test(lines[0])) lines[0] = '```text';
      return lines.join('\n');
    })
    .join('\n');
}

/** Replace $NEAR in prose (outside fenced blocks and inline code spans) */
function fixNear(text) {
  // Split around inline code spans so we don't touch `$NEAR`
  const inlineCodeRe = /`[^`\n]+`/g;
  const parts = [];
  let last = 0;
  let m;

  while ((m = inlineCodeRe.exec(text)) !== null) {
    parts.push(text.slice(last, m.index).replace(/\$NEAR/g, '`$NEAR`'));
    parts.push(m[0]); // keep inline code as-is
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last).replace(/\$NEAR/g, '`$NEAR`'));
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Frontmatter: remove Docusaurus-only fields, convert others to Mintlify
// ---------------------------------------------------------------------------
const DOCUSAURUS_FM_REMOVE = ['id', 'sidebar_position', 'slug'];

function fixFrontmatter(content) {
  return content.replace(/^---\n([\s\S]*?)\n---/, (_, body) => {
    const cleaned = body
      .split('\n')
      .filter(line => {
        const key = line.match(/^(\w+)\s*:/)?.[1];
        return !key || !DOCUSAURUS_FM_REMOVE.includes(key);
      })
      .map(line => {
        // sidebar_label → sidebarTitle
        return line.replace(/^sidebar_label\s*:/, 'sidebarTitle:');
      })
      .join('\n');
    return `---\n${cleaned}\n---`;
  });
}

// ---------------------------------------------------------------------------
// Docusaurus heading IDs: ## Title {#anchor} → ## Title
// ---------------------------------------------------------------------------
function fixHeadingIds(text) {
  return text.replace(/^(#{1,6}[^\n{]+?)\s*\{#[^}]+\}/gm, '$1');
}

// ---------------------------------------------------------------------------
// Internal links: strip .md extension  [text](./file.md) → [text](./file)
// ---------------------------------------------------------------------------
function fixMdLinks(text) {
  // Only strip from relative links (starting with ./ ../ or just a path without http)
  return text.replace(/\[([^\]]+)\]\(([^)]+)\.md([^)]*)\)/g, (_, label, path, anchor) => {
    return `[${label}](${path}${anchor})`;
  });
}

// ---------------------------------------------------------------------------
// <Tabs> / <TabItem> → <Tabs> / <Tab>
// ---------------------------------------------------------------------------
function fixTabs(text) {
  // Remove Tabs / TabItem import lines
  text = text.replace(/^import\s+Tabs\s+from\s+['"]@theme\/Tabs['"]\s*;?\s*\n/gm, '');
  text = text.replace(/^import\s+TabItem\s+from\s+['"]@theme\/TabItem['"]\s*;?\s*\n/gm, '');

  // <TabItem value="..." label="Title" ...> → <Tab title="Title">
  text = text.replace(
    /<TabItem\b[^>]*\blabel=["']([^"']+)["'][^>]*>/g,
    (_, label) => `<Tab title="${label}">`
  );
  // <TabItem value="..." ...> (no label) → <Tab title="..."> using value
  text = text.replace(
    /<TabItem\b[^>]*\bvalue=["']([^"']+)["'][^>]*>/g,
    (_, value) => `<Tab title="${value}">`
  );

  text = text.replace(/<\/TabItem>/g, '</Tab>');

  // Remove leftover }> Docusaurus JSX artifact immediately after <Tab title="...">
  text = text.replace(/(<Tab\b[^>]*>)\s*}>[ \t]*/g, '$1');

  return text;
}

// ---------------------------------------------------------------------------
// GFM footnotes → inline <sup> refs + ## References list
// ---------------------------------------------------------------------------
function fixFootnotes(content) {
  // Parse all footnote definitions: [^key]: [text](url)  or  [^key]: plain text
  const definitions = {};
  const defRe = /^\[\^(\w+)\]:\s+(.+)$/gm;
  let m;
  while ((m = defRe.exec(content)) !== null) {
    const key = m[1];
    const value = m[2].trim();
    const linkMatch = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    definitions[key] = linkMatch
      ? { text: linkMatch[1], url: linkMatch[2] }
      : { text: value, url: null };
  }

  if (Object.keys(definitions).length === 0) return content;

  // Replace inline [^key] references (negative lookahead skips definition lines)
  content = content.replace(/\[\^(\w+)\](?!:)/g, (match, key) => {
    const def = definitions[key];
    if (!def) return match;
    return def.url
      ? `<sup>[[${key}]](${def.url})</sup>`
      : `<sup>[${key}]</sup>`;
  });

  // Remove any remaining standalone footnote definition lines
  content = content.replace(/^\[\^\w+\]:[^\n]+\n?/gm, '');

  return content;
}

// ---------------------------------------------------------------------------
// <CodeTabs> / <Language> → <CodeGroup>
// ---------------------------------------------------------------------------
function fixCodeTabs(text) {
  // Remove CodeTabs import lines
  text = text.replace(/^import\s+\{[^}]*CodeTabs[^}]*\}[^\n]*\n/gm, '');

  // <CodeTabs> wrapper → <CodeGroup>
  text = text.replace(/<CodeTabs>/g, '<CodeGroup>');
  text = text.replace(/<\/CodeTabs>/g, '</CodeGroup>');

  // <Language value="js" language="javascript"> ... </Language>
  // The code block inside keeps its fences; we just remove the <Language> wrapper tags
  text = text.replace(
    /<Language\s[^>]*language=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Language>/g,
    (_, _lang, body) => body.trim()
  );

  return text;
}

// ---------------------------------------------------------------------------
// Scan: find Docusaurus imports in a file (no writes)
// ---------------------------------------------------------------------------
const DOCUSAURUS_IMPORT_RE = /^import\s+.*from\s+['"](@theme\/|@site\/)[^'"]*['"]\s*;?\s*$/gm;

function scanImports(content) {
  return [...content.matchAll(DOCUSAURUS_IMPORT_RE)].map(m => m[0].trim());
}

// ---------------------------------------------------------------------------
// File discovery: recursively find all .md / .mdx files
// ---------------------------------------------------------------------------
function findFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...findFiles(full));
    } else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main transform pipeline
// ---------------------------------------------------------------------------
function transform(content) {
  let out = content;
  out = fixFrontmatter(out);
  out = applyOutsideFenced(out, fixSubsectionHr);
  out = applyOutsideFenced(out, fixLessonBlockquotes);
  out = applyOutsideFenced(out, fixAdmonitions);
  out = applyOutsideFenced(out, fixCalloutTitles);
  out = fixDetails(out);
  out = fixBareFences(out);
  out = applyOutsideFenced(out, fixNear);
  out = applyOutsideFenced(out, fixMdLinks);
  out = applyOutsideFenced(out, fixHeadingIds);
  out = fixTabs(out);
  out = fixCodeTabs(out);
  out = fixFootnotes(out);
  // Collapse 3+ blank lines down to 2
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const root = args.find(a => !a.startsWith('--')) ?? '.';

const files = findFiles(root);

if (!files.length) {
  console.log('No .md / .mdx files found.');
  process.exit(0);
}

console.log(`Found ${files.length} files in "${root}"\n`);

let changed = 0, renamed = 0, unchanged = 0;
const errors = [];

for (const file of files) {
  try {
    const original = fs.readFileSync(file, 'utf8');
    const transformed = transform(original);

    if (transformed !== original) {
      fs.writeFileSync(file, transformed, 'utf8');
      changed++;
    } else {
      unchanged++;
    }

    if (file.endsWith('.md')) {
      fs.renameSync(file, file.replace(/\.md$/, '.mdx'));
      renamed++;
    }
  } catch (e) {
    errors.push(`${file}: ${e.message}`);
  }
}

console.log(`✓ Transformed : ${changed}`);
console.log(`✓ Renamed .md → .mdx : ${renamed}`);
console.log(`- Unchanged   : ${unchanged}`);
if (errors.length) {
  console.log('\nErrors:');
  errors.forEach(e => console.log(`  ✗ ${e}`));
}

// Show files that still have Docusaurus imports after the fix
const allFiles = findFiles(root);
const findings = [];
for (const file of allFiles) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const imports = scanImports(content);
    if (imports.length) findings.push({ file, imports });
  } catch (e) { /* skip unreadable */ }
}

if (findings.length) {
  console.log('\nFiles with remaining Docusaurus imports:');
  for (const { file, imports } of findings) {
    console.log(file);
    imports.forEach(imp => console.log(`  ${imp}`));
    console.log();
  }
  console.log(`Total: ${findings.length} / ${allFiles.length} files`);
} else {
  console.log('\nNo remaining Docusaurus imports found.');
}
