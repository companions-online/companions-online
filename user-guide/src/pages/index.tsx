import Layout from '@theme/Layout';
import GameEmbed from '../components/GameEmbed';
import ThreeColumns from '../components/ThreeColumns';

export default function Home() {
  return (
    <Layout
      title="Companions Online"
      description="Isometric 2D MMO with mixed player + LLM interaction"
    >
      <GameEmbed />
      <ThreeColumns />
    </Layout>
  );
}
