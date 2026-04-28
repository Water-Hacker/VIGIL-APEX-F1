import { makeSectoralAdapter } from './_sectoral-ministry.js';

makeSectoralAdapter({
  sourceId: 'minesec-secondary-ed',
  baseUrl: 'https://www.minesec.gov.cm',
  listingPaths: ['/marches', '/appels-offres'],
});
