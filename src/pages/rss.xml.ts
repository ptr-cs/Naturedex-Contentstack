import type { APIRoute } from 'astro';
import { readContentSnapshot } from '../lib/content';
function xml(text: string) { return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;'); }
export const GET: APIRoute = async ({ site }) => {
  const { posts } = readContentSnapshot();
  const items = posts.map(post => {
    const url = new URL(`/journal/${post.slug}/`, site).href;
    return `<item><title>${xml(post.title)}</title><link>${xml(url)}</link><guid>${xml(url)}</guid><description>${xml(post.excerpt)}</description>${post.publishedAt ? `<pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>` : ''}</item>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Naturedex field journal</title><link>${xml(site!.href)}</link><description>Small observations from Virginia's wild world.</description><language>en-us</language>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
