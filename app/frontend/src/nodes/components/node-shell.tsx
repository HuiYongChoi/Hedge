import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import { Trash2 } from 'lucide-react';
import { ReactNode } from 'react';

export interface NodeShellProps {
  id: string;
  selected?: boolean;
  isConnectable?: boolean;
  icon: ReactNode;
  iconColor?: string;
  name: string;
  description?: string;
  children: ReactNode;
  hasLeftHandle?: boolean;
  hasRightHandle?: boolean;
  status?: string;
  width?: string;
}

export function NodeShell({
  id,
  selected,
  isConnectable,
  icon,
  iconColor,
  name,
  description,
  children,
  hasLeftHandle = true,
  hasRightHandle = true,
  status = 'IDLE',
  width = 'w-64',
}: NodeShellProps) {
  const isInProgress = status === 'IN_PROGRESS';
  const { deleteElements } = useReactFlow();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this node?')) {
      return;
    }
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div
      className={cn(
        "react-flow__node-default group relative select-none cursor-pointer p-0 rounded-lg border border-node transition-all duration-200",
        width,
        !selected && "hover:border-node-hover hover:shadow-lg",
        selected && "border-node-selected shadow-xl",
        isInProgress && "node-in-progress"
      )}
      data-id={id}
      data-nodeid={id}
    >
      {isInProgress && (
        <div className="animated-border-container"></div>
      )}
      {hasLeftHandle && (
        <Handle
          type="target"
          position={Position.Left}
          className="w-3 h-3 rounded-full bg-gray-500 border-2 border-card absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-200 hover:bg-gray-500 hover:w-4 hover:h-4 hover:shadow-[0_0_5px_2px_rgba(59,130,246,0.3)]"
          isConnectable={isConnectable}
        />
      )}
      <div className="overflow-hidden rounded-lg">
        <Card className="bg-node rounded-none overflow-hidden border-none">
          <CardHeader className="p-3 bg-node flex flex-row items-center space-x-2 rounded-t-sm relative">
            <div className={cn(
              "flex items-center justify-center h-8 w-8 rounded-lg text-primary",
              isInProgress ? "gradient-animation" : iconColor
            )}>
              {icon}
            </div>
            <div className="text-title font-semibold text-primary flex-1">
              {name || "Custom Component"}
            </div>
            <button
              onClick={handleDelete}
              className={cn(
                "absolute top-2 right-2 h-6 w-6 flex items-center justify-center rounded-sm text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all",
                selected ? "opacity-100" : "opacity-70 group-hover:opacity-100"
              )}
              title="Delete node"
              aria-label="Delete node"
            >
              <Trash2 size={13} />
            </button>
          </CardHeader>
          {description && (
            <div className="px-3 py-2 text-subtitle text-primary text-left">
              {description}
            </div>
          )}
          {children}
        </Card>
      </div>
      {hasRightHandle && (
        <Handle
          type="source"
          position={Position.Right}
          className="w-3 h-3 rounded-full bg-gray-500 border-2 border-card absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-200 hover:bg-gray-500 hover:w-4 hover:h-4 hover:shadow-[0_0_5px_2px_rgba(59,130,246,0.3)]"
          isConnectable={isConnectable}
        />
      )}
    </div>
  );
}
