import styles from './ThreeColumns.module.css';

// Lorem-ipsum filler for the landing page mid-section. Real copy lands
// once positioning + audience are pinned down.
const COLUMNS = [
  {
    title: 'Build a world',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  },
  {
    title: 'Play with companions',
    body: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  },
  {
    title: 'AI that lives there',
    body: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  },
];

export default function ThreeColumns() {
  return (
    <section className={styles.section}>
      <div className={styles.row}>
        {COLUMNS.map((c) => (
          <div key={c.title} className={styles.col}>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
