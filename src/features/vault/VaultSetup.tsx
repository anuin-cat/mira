import { FolderOpen, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { setupVault } from '../../services/vaultService'

interface Props {
  onVaultReady: (path: string) => void
}

/** Vault 首次配置页面 */
export function VaultSetup({ onVaultReady }: Props) {
  async function handleSelectVault() {
    const path = await setupVault()
    if (path) onVaultReady(path)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--theme-bg-sidebar)] px-6">
      <Card className="w-full max-w-md gap-0 border border-border/70 bg-card/95 py-0 shadow-2xl shadow-black/6 backdrop-blur-sm">
        <CardHeader className="space-y-4 px-8 pt-8 pb-4">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-secondary text-foreground">
            <Sparkles className="size-6" />
          </div>
          <div className="space-y-2 text-center">
            <CardTitle className="text-2xl tracking-tight">欢迎使用 Mira</CardTitle>
            <CardDescription className="text-sm leading-6 text-muted-foreground">
              请选择一个普通文件夹作为 Vault，Mira 会直接管理其中的 Markdown 文件。
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-8 pt-2 pb-8">
          <Button onClick={handleSelectVault} className="h-10 w-full gap-2 text-sm">
            <FolderOpen className="size-4" />
            选择 Vault 目录
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
