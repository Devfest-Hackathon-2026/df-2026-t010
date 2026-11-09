import { RobotIcon } from '@phosphor-icons/react/dist/csr/Robot'
import { CarProfileIcon } from '@phosphor-icons/react/dist/csr/CarProfile'
import { PencilRulerIcon } from '@phosphor-icons/react/dist/csr/PencilRuler'
import { FlowerTulipIcon } from '@phosphor-icons/react/dist/csr/FlowerTulip'
import { ShapesIcon } from '@phosphor-icons/react/dist/csr/Shapes'
export function CraftVisual({ kind = 'art', className = '' }: { kind?: string; className?: string }) {
  const Icon = ({ robot: RobotIcon, car: CarProfileIcon, organizer: PencilRulerIcon, flower: FlowerTulipIcon } as Record<string, typeof RobotIcon>)[kind] ?? ShapesIcon
  return <div className={`craft-visual craft-visual--${kind} ${className}`} aria-hidden="true"><span className="visual-orbit" /><Icon className="visual-main" size={100} weight="duotone" /></div>
}
