interface PlaceholderProps {
  title: string;
  description?: string;
}

export function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight mb-2">{title}</h1>
      {description && <p className="text-muted-foreground mb-6">{description}</p>}
      <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        本页面会在后续里程碑(M9 - M12)中实现。
      </div>
    </div>
  );
}
