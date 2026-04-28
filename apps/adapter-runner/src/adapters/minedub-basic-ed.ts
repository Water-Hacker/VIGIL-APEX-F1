import { makeSectoralAdapter } from './_sectoral-ministry.js';

makeSectoralAdapter({
  sourceId: 'minedub-basic-ed',
  baseUrl: 'https://www.minedub.cm',
  listingPaths: ['/marches', '/appels-offres'],
});
