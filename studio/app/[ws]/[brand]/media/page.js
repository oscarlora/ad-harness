import Gallery from '../../../../components/media/Gallery.js';
import { brandMetadata, brandPage } from '../../../../lib/server/brands.js';

export const generateMetadata = brandMetadata('Media');
export default brandPage(Gallery);
