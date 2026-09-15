import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '../components/ui/button'

export const Route = createFileRoute('/')({ component: Landing })

function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-5xl font-bold tracking-tight">PostPilot</h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Drafts LinkedIn posts in your voice, checks them against your positioning, and queues them for one approval.
        Nothing publishes without you.
      </p>
      <Link to="/app">
        <Button size="lg">Open the console</Button>
      </Link>
    </main>
  )
}
