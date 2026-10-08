import type { ImageCategories } from "@/lib/annotations";

type Props = { categories: ImageCategories };

function labelText(category: { code: string | null; name: string }) {
    return category.code ? `${category.code} ${category.name}` : category.name;
}

function percent(confidence: number) {
    return `${Math.round(confidence * 100)}%`;
}

export function SuggestionsPanel({ categories }: Props) {
  const { expert, ml } = categories;

  return (
    <section aria-label="Suggested categories" className="rounded-lg border p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Expert category</h2>
        {expert ? (
          <p>{labelText(expert)}</p>
        ) : (
          <p className="text-sm text-gray-500">No expert category</p>
        )}
      </div>

      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Model suggestion</h2>
        {ml ? (
          <>
            <ol className="space-y-1">
              {ml.labels.map((label, i) => (
                <li
                  key={i}
                  className={`flex justify-between gap-4 ${i === 0 ? "font-semibold" : "text-sm"}`}
                >
                  <span>{labelText(label)}</span>
                  <span>{percent(label.confidence)}</span>
                </li>
              ))}
            </ol>
            {ml.modelVersion && (
              <p className="text-xs text-gray-500">Model {ml.modelVersion}</p>
            )}
          </>
        ) : (
          <>
            <p className="font-medium">Pending</p>
            <p className="text-sm text-gray-500">
              The model has not classified this image yet. You can annotate it now.
            </p>
          </>
        )}
      </div>
    </section>
  );
}