import HomeIndex from '../components/HomeIndex.js';

export const dynamic = 'force-dynamic'; // the layout's brand list is read on each visit

export default function Home() {
  return <HomeIndex />;
}
