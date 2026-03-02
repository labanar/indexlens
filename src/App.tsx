import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"

function App() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <h1 className="text-2xl font-bold p-4">IndexLens</h1>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}

export default App
