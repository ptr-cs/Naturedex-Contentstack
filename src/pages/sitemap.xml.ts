import type { APIRoute } from 'astro';
import { readContentSnapshot } from '../lib/content';
export const GET: APIRoute = async ({ site }) => {
  const { posts } = readContentSnapshot();
  const paths = ['/', '/map/', '/journal/', '/about/', ...posts.map(post => `/journal/${post.slug}/`)];
  const body = paths.map(path => `<url><loc>${new URL(path, site).href.replaceAll('&', '&amp;')}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
