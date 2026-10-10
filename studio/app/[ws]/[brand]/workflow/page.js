import Workflow from '../../../../components/workflow/Workflow.js';
import { brandMetadata, brandPage } from '../../../../lib/server/brands.js';

export const dynamic = 'force-dynamic';
export const generateMetadata = brandMetadata('Workflow');
export default brandPage(Workflow);
