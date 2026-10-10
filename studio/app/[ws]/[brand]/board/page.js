import Board from '../../../../components/board/Board.js';
import { brandMetadata, brandPage } from '../../../../lib/server/brands.js';

export const dynamic = 'force-dynamic';
export const generateMetadata = brandMetadata('Board');
export default brandPage(Board);
