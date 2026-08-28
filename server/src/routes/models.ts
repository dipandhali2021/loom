import { Router } from 'express';

import { defaultModel, getModels } from '../models.ts';

/**
 * GET /api/v1/models
 *
 * What the app's picker is built from. The proxy is the source of truth, and this
 * route exists only to keep `AI_API_KEY` out of the client: the app could otherwise
 * read the same list directly from the proxy, but only by shipping the key into a
 * bundle anyone can extract it from.
 *
 * No capabilities are reported, because a combo has none to report -- the proxy
 * serialises one as `{id, object, owned_by}` and nothing more. Whether it can read
 * an image is decided inside the proxy by its Vision Adapter, so there is nothing
 * here for the app to gate on and it always allows attachments.
 *
 * `?refresh=1` skips the server's cache, for the app opening its picker. See
 * `getModels`: it is floored upstream, so this is not a way to hammer the proxy.
 */

export const modelsRouter = Router();

modelsRouter.get('/', async (req, res) => {
  // Any truthy-looking value, since this is a URL a human may also type.
  const force = req.query.refresh !== undefined && req.query.refresh !== '0';
  const models = await getModels({ force });
  res.json({ models, defaultModel: defaultModel(models) });
});
