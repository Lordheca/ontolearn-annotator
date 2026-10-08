import type { ImageCategories } from "@/lib/annotations";

type Props = { categories: ImageCategories };
type Category = { code: string | null; name: string };

function labelText(category: Category) {
    return category.code ? `${category.code} ${category.name}` : category.name;
}

function percent(confidence: number) {
    return `${Math.round(confidence * 100)}%`;
}

function sameClass(a: Category, b: Category) {
    return a.code && b.code ? a.code === b.code : a.name === b.name;
}

export function SuggestionsPanel({ categories }: Props) {
  const { expert, ml } = categories;
  const topLabel = ml?.labels[0];
  const agreement = expert && topLabel ? (sameClass(expert, topLabel) ? "agree" : "differ") : null;

  return (
    <section 
        aria-label="Suggested categories" 
        className="rounded-lg border p-4 space-y-4 bg-white dark:bg-gray-900 dark:border-gray-700"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Expert category</h2>
        {expert ? (
          <p>{labelText(expert)}</p>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">No expert category</p>
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
              <p className="text-xs text-gray-500 dark:text-gray-400">Model {ml.modelVersion}</p>
            )}
          </>
        ) : (
          <>
            <p className="font-medium">Pending</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              The model has not classified this image yet. You can annotate it now.
            </p>
          </>
        )}
      </div>
        {agreement === "agree" && (
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
               <span aria-hidden="true">✓ </span>Expert and model agree
            </p>
      )}
        {agreement === "differ" && (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
               <span aria-hidden="true">≠ </span>Expert and model differ
            </p>
        )}
    </section>
  );
}