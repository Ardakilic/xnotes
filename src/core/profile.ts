const HOSTS = new Set(['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com']);

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

export const RESERVED: readonly string[] = [
  'home',
  'explore',
  'notifications',
  'messages',
  'bookmarks',
  'search',
  'settings',
  'i',
  'compose',
  'lists',
  'hashtag',
  'tos',
  'privacy',
  'about',
  'login',
  'logout',
  'signup',
  'intent',
  'share',
  'account',
  'communities',
  'premium',
  'premium_sign_up',
  'verified_orgs',
  'jobs',
  'topics',
  'connect_people',
  'follower_requests',
  'your_twitter_data',
  'personalization',
  'display',
  'download',
  'flow',
  'oauth',
  'oauth2',
  'widgets',
  'tweet',
  'status',
  'home_timeline',
  'mentions',
  'moments',
  'analytics',
  'ads',
  'help',
  'who_to_follow',
  'graphql',
  'live',
  'broadcasts',
  'spaces',
];

export const PROFILE_SUBTABS: readonly string[] = [
  'with_replies',
  'media',
  'likes',
  'highlights',
  'superfollows',
  'affiliates',
  'articles',
  'verified_followers',
];

const RESERVED_SET = new Set(RESERVED);
const SUBTAB_SET = new Set(PROFILE_SUBTABS);

export function parseProfile(url: URL): { handle: string } | null {
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const first = segments[0];
  if (first === undefined) return null;
  if (!HANDLE_PATTERN.test(first)) return null;
  if (RESERVED_SET.has(first.toLowerCase())) return null;
  const second = segments[1];
  if (second !== undefined && !SUBTAB_SET.has(second.toLowerCase())) return null;
  return { handle: first };
}
