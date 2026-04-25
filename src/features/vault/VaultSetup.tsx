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
        <p>请选择一个普通文件夹作为 Vault，Mira 会直接管理其中的 Markdown 文件。</p>
        <button onClick={handleSelectVault} className="btn-primary">
          选择 Vault 目录
        </button>
      </div>
    </div>
  )
}
