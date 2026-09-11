import { LoginForm } from './components/LoginForm'
import { ShowcasePanel } from './components/ShowcasePanel'
import styles from './LoginPage.module.css'

export function LoginPage() {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <ShowcasePanel />
        <section className={styles.formPane}>
          <LoginForm />
        </section>
      </div>
    </main>
  )
}
