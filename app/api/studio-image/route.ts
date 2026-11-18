import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { storage } from '@/lib/storage';
import { createStudioImageService, localRequest, resolveImageApiKey } from '@/lib/studio-image-server';

type Bindings = Record<string, unknown> & { IMAGE_MODEL?: string };
const service = createStudioImageService({
  settings() {
    const e = env as unknown as Bindings;
    return { key: resolveImageApiKey(e), model: e.IMAGE_MODEL || 'gpt-image-1.5' };
  },
  async identity(req) {
    if (localRequest(req.url)) return 'local-development';
    return (await getChatGPTUser())?.userId || null;
  },
  storage,
  fetch: (...args) => fetch(...args),
});

export const GET = service.GET;
export const POST = service.POST;
