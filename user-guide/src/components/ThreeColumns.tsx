import Link from '@docusaurus/Link';
import styles from './ThreeColumns.module.css';

const COLUMNS = [
  {
    title: 'Survive together',
    body: 'Gather wood and stone, craft tools and weapons, fight off the things that come out at night.',
    href: '/user-guide/player-guide/survival-basics',
  },
  {
    title: 'Build a world',
    body: 'Place walls, doors, and floors. Bridge a river with a wooden plank. Set up a base your friends can find.',
    href: '/user-guide/player-guide/building',
  },
  {
    title: 'Bring your own companion into the game',
    body: 'Point any MCP-speaking LLM at the server and it plays the same game you do — with the same actions, on the same map.',
    href: '/user-guide/ai-companions/concept',
  },
];

export default function ThreeColumns() {
  return (
    <section className={styles.section}>
      <div className={styles.row}>
        {COLUMNS.map((c) => (
          <Link key={c.title} to={c.href} className={styles.col}>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
