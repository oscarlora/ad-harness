import Workflow from '../../../../../components/workflow/Workflow.js';
import { brandMetadata, brandPage } from '../../../../../lib/server/brands.js';

export const dynamic = 'force-dynamic';

const adOf = async (params) => { try { return decodeURIComponent((await params).ad); } catch { return ''; } };

export const generateMetadata = brandMetadata(async (params) => `Ad ${parseInt(await adOf(params), 10) || ''}`);
export default brandPage(Workflow, async (params) => ({ ad: await adOf(params) }));
