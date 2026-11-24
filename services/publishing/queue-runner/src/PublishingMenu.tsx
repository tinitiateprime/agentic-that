import { ArrowLeft, CalendarDays, ListFilter, Settings2, Sparkles, Upload } from 'lucide-react';
import styles from './publishing-menu.module.css';

// One menu for the whole Publishing service: writing a post with AI and the
// posting workboard (create, review, schedule). Social accounts and their
// health are managed on Accounts. The workboard lives
// on /publishing as one long page; from elsewhere its items open it at that part.
export type PublishingView = 'ai' | 'overview' | 'operations' | 'schedule';

type Props = {
  active: PublishingView;
  /** On the workboard: scroll to a part instead of loading the page. */
  onNavigate?: (view: Exclude<PublishingView, 'ai'>) => void;
  reviewCount?: number;
  schedulingEnabled?: boolean;
  /** People without posting access only get Create with AI. */
  showWorkboard?: boolean;
};

export default function PublishingMenu({ active, onNavigate, reviewCount = 0, schedulingEnabled = true, showWorkboard = true }: Props) {
  const go = (view: Exclude<PublishingView, 'ai'>) => {
    if (onNavigate) onNavigate(view);
    else window.location.href = `/publishing#${view}`;
  };
  const item = (view: PublishingView) => (active === view ? `${styles.item} ${styles.active}` : styles.item);
  return (
    <aside className={styles.menu} aria-label='Publishing menu'>
      <a className={styles.brand} href='/apps' title='Back to Home'>
        <span>AT</span>
        <div><strong>Publishing</strong><small>Write, post and schedule</small></div>
      </a>
      <nav aria-label='Publishing'>
        <a className={item('ai')} href='/publishing/ai' aria-current={active === 'ai' ? 'page' : undefined}><Sparkles size={17} />Create with AI</a>
        {showWorkboard && <>
          <button type='button' className={item('overview')} onClick={() => go('overview')}><Upload size={17} />Create</button>
          <button type='button' className={item('operations')} onClick={() => go('operations')}><ListFilter size={17} />Review {reviewCount > 0 && <small>{reviewCount}</small>}</button>
          {schedulingEnabled && <button type='button' className={item('schedule')} onClick={() => go('schedule')}><CalendarDays size={17} />Schedule</button>}
        </>}
        <a className={styles.item} href='/config-manager?service=publishing'><Settings2 size={17} />Accounts</a>
      </nav>
      <a className={styles.home} href='/apps'><ArrowLeft size={17} />Back to Home</a>
    </aside>
  );
}
