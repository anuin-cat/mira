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
    <div className="vault-setup">
      <div className="vault-setup-card">
        <h1>欢迎使用 Mira</h1>
        <p>请选择一个目录作为你的 Vault，所有笔记将以 Markdown 文件存储在此。</p>
        <button onClick={handleSelectVault} className="btn-primary">
          选择 Vault 目录
        </button>
      </div>
    </div>
  )
}
