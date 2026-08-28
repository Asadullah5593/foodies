import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Modal from './Modal';
import Button from './Button';

export interface ReorderRow {
  id: number;
  name: string;
  /** Shown greyed after the name, e.g. a category name or "inactive". */
  hint?: string;
}

const SortableRow: React.FC<{ row: ReorderRow; position: number }> = ({ row, position }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg"
    >
      <span
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-xl flex-shrink-0"
      >
        ⠿
      </span>
      <span className="w-8 text-sm font-semibold text-gray-400 tabular-nums">{position}</span>
      <span className="flex-1 text-sm text-gray-800 truncate">{row.name}</span>
      {row.hint && <span className="text-xs text-gray-400 truncate">{row.hint}</span>}
    </div>
  );
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Full scoped list, already in current display order. Never a page of it. */
  rows: ReorderRow[];
  onSave: (orderedIds: number[]) => void;
  isSaving?: boolean;
  /** Explains what the numbers on the left will become. */
  note?: string;
}

/**
 * Drag-to-reorder over a COMPLETE scoped list (one brand, or one brand+category).
 *
 * Deliberately not inline on the list pages: those paginate client-side, so
 * dragging there would send only the visible page and renumber a fragment of
 * the category. Saving rewrites the scope to a contiguous 1..N.
 */
const ReorderModal: React.FC<Props> = ({
  isOpen,
  onClose,
  title,
  rows,
  onSave,
  isSaving,
  note,
}) => {
  const [order, setOrder] = React.useState<ReorderRow[]>(rows);

  // Re-seed whenever the scope changes or the modal is reopened, so a stale
  // drag from a previous scope can never be saved.
  React.useEffect(() => {
    if (isOpen) setOrder(rows);
  }, [isOpen, rows]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const from = prev.findIndex((r) => r.id === active.id);
      const to = prev.findIndex((r) => r.id === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="large">
      <div className="space-y-3">
        <p className="text-sm text-gray-500">
          {note ?? 'Drag rows into the order customers should see. Saving numbers them 1 upwards.'}
        </p>
        {order.length === 0 ? (
          <p className="text-center text-gray-500 py-8">Nothing here to reorder.</p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto pr-1">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={order.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {order.map((row, i) => (
                    <SortableRow key={row.id} row={row} position={i + 1} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            isLoading={isSaving}
            disabled={order.length === 0}
            onClick={() => onSave(order.map((r) => r.id))}
          >
            Save order
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ReorderModal;
