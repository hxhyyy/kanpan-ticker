import * as path from 'path';
import * as fs from 'fs';
import JSZip from 'jszip';

export interface EpubChapter {
  id: string;
  title: string;
  /** Plain-text paragraphs / sentences ready for status-bar reading */
  segments: string[];
}

export interface EpubBook {
  title: string;
  author: string;
  filePath: string;
  chapters: EpubChapter[];
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtml(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '');
  text = decodeXmlEntities(text);
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Drop cover filenames, image paths, and other non-prose EPUB junk. */
function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) {
    return true;
  }
  if (/^(cover|toc|nav|copyright|titlepage)$/i.test(t)) {
    return true;
  }
  if (/\.(jpe?g|png|gif|svg|css|xhtml?|xml|opf|ncx)$/i.test(t)) {
    return true;
  }
  // Long production / asset filenames without Chinese prose
  if (/[_-]/.test(t) && !/[\u4e00-\u9fff]/.test(t) && t.length > 24) {
    return true;
  }
  if (/Eric-Jorgenson|Almanack-of-Naval|PRODUCTION_v\d+/i.test(t)) {
    return true;
  }
  return false;
}

/** Split chapter text into sentence-level segments (no mid-sentence chopping). */
export function splitIntoSegments(text: string): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !isNoiseLine(p));

  const segments: string[] = [];

  for (const para of paragraphs) {
    const sentences = para
      .split(/(?<=[。！？…!?])\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !isNoiseLine(s));

    if (sentences.length === 0) {
      continue;
    }
    for (const sentence of sentences) {
      segments.push(sentence);
    }
  }

  return segments;
}

function resolveHref(baseDir: string, href: string): string {
  const clean = href.split('#')[0].replace(/\\/g, '/');
  if (!baseDir || baseDir === '.') {
    return clean;
  }
  // Simple posix join relative to OPF directory
  const joined = path.posix.normalize(path.posix.join(baseDir, clean));
  return joined.replace(/^\.\//, '');
}

function attr(tag: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = tag.match(re);
  return m?.[1];
}

function extractTitleFromHtml(html: string, fallback: string): string {
  const h = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (h) {
    const t = stripHtml(h[1]).trim();
    if (t) {
      return t.slice(0, 80);
    }
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const t = stripHtml(title[1]).trim();
    if (t && !/^untitled$/i.test(t)) {
      return t.slice(0, 80);
    }
  }
  return fallback;
}

export async function parseEpub(filePath: string): Promise<EpubBook> {
  const buf = await fs.promises.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);

  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) {
    throw new Error('无效的 EPUB：缺少 META-INF/container.xml');
  }

  const rootfileMatch = containerXml.match(/full-path\s*=\s*["']([^"']+)["']/i);
  if (!rootfileMatch) {
    throw new Error('无效的 EPUB：找不到 rootfile');
  }

  const opfPath = rootfileMatch[1].replace(/\\/g, '/');
  const opfDir = path.posix.dirname(opfPath);
  const opfXml = await zip.file(opfPath)?.async('string');
  if (!opfXml) {
    throw new Error(`无效的 EPUB：找不到 ${opfPath}`);
  }

  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatch = opfXml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const bookTitle = titleMatch ? decodeXmlEntities(stripHtml(titleMatch[1])).trim() : path.basename(filePath, '.epub');
  const author = creatorMatch ? decodeXmlEntities(stripHtml(creatorMatch[1])).trim() : '';

  const manifest = new Map<string, { href: string; mediaType: string }>();
  const itemRe = /<item\b[^>]*>/gi;
  let itemTag: RegExpExecArray | null;
  while ((itemTag = itemRe.exec(opfXml))) {
    const tag = itemTag[0];
    const id = attr(tag, 'id');
    const href = attr(tag, 'href');
    const mediaType = attr(tag, 'media-type') || '';
    if (id && href) {
      manifest.set(id, { href, mediaType });
    }
  }

  const spineIds: string[] = [];
  const itemrefRe = /<itemref\b[^>]*>/gi;
  let refTag: RegExpExecArray | null;
  while ((refTag = itemrefRe.exec(opfXml))) {
    const idref = attr(refTag[0], 'idref');
    if (idref) {
      spineIds.push(idref);
    }
  }

  // Optional Nav / NCX for better chapter titles
  const navTitles = new Map<string, string>();
  for (const [, item] of manifest) {
    if (
      item.mediaType === 'application/x-dtbncx+xml' ||
      /nav\.xhtml?$/i.test(item.href) ||
      item.mediaType.includes('navigation')
    ) {
      const navPath = resolveHref(opfDir === '.' ? '' : opfDir, item.href);
      const navXml = await zip.file(navPath)?.async('string');
      if (!navXml) {
        continue;
      }
      // EPUB3 nav
      const aRe = /<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
      let a: RegExpExecArray | null;
      while ((a = aRe.exec(navXml))) {
        const href = resolveHref(path.posix.dirname(navPath), a[1]);
        const label = stripHtml(a[2]).trim();
        if (label) {
          navTitles.set(href, label);
        }
      }
      // NCX
      const ncxRe =
        /<navLabel>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>[\s\S]*?<content\b[^>]*src\s*=\s*["']([^"'#]+)/gi;
      let n: RegExpExecArray | null;
      while ((n = ncxRe.exec(navXml))) {
        const label = stripHtml(n[1]).trim();
        const href = resolveHref(path.posix.dirname(navPath), n[2]);
        if (label) {
          navTitles.set(href, label);
        }
      }
    }
  }

  const chapters: EpubChapter[] = [];
  let chapterIndex = 0;

  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) {
      continue;
    }
    if (!/html|xml|xhtml/i.test(item.mediaType) && !/\.x?html?$/i.test(item.href)) {
      continue;
    }

    const hrefPath = resolveHref(opfDir === '.' ? '' : opfDir, item.href);
    const html = await zip.file(hrefPath)?.async('string');
    if (!html) {
      continue;
    }

    const plain = stripHtml(html);
    const segments = splitIntoSegments(plain);
    if (segments.length === 0) {
      continue;
    }

    // Skip image-only / filename-only spine items
    const meaningful = segments.filter((s) => /[\u4e00-\u9fffA-Za-z]/.test(s) && s.length >= 2);
    if (meaningful.length === 0) {
      continue;
    }

    chapterIndex += 1;
    let title =
      navTitles.get(hrefPath) ||
      extractTitleFromHtml(html, `第 ${chapterIndex} 章`);
    if (isNoiseLine(title)) {
      title = meaningful[0].slice(0, 40);
    }

    chapters.push({
      id: `${id}:${hrefPath}`,
      title,
      segments: meaningful,
    });
  }

  if (chapters.length === 0) {
    throw new Error('未能从 EPUB 中解析出可读正文');
  }

  return {
    title: bookTitle || path.basename(filePath, '.epub'),
    author,
    filePath,
    chapters,
  };
}
