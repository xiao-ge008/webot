export default function TestChart({ element }: any) {
    const { props: elementProps } = element;


    // Return a flat spec directly to ensure maximum reliability with @json-render/react
    return {
        root: "card-root",
        elements: {
            "card-root": {
                type: "Card",
                props: { className: "w-full shadow-sm border-border" },
                children: ["header", "content", "footer"]
            },
            "header": {
                type: "CardHeader",
                children: ["title", "desc"]
            },
            "title": {
                type: "CardTitle",
                props: { children: "Dynamic Chart Activity" }
            },
            "desc": {
                type: "CardDescription",
                props: { children: "Live data loaded from local skill file" }
            },
            "content": {
                type: "CardContent",
                props: { className: "space-y-4" },
                children: ["box"]
            },
            "box": {
                type: "Box",
                props: { className: "p-4 bg-muted/50 rounded-lg border border-border/50 font-mono text-[11px]" },
                children: ["label", "data"]
            },
            "label": {
                type: "div",
                props: { className: "text-muted-foreground uppercase font-bold text-[10px] mb-2", children: "Payload Data:" }
            },
            "data": {
                type: "pre",
                props: { children: JSON.stringify(elementProps || {}, null, 2) }
            },
            "footer": {
                type: "CardFooter",
                props: { className: "flex justify-end" },
                children: ["btn"]
            },
            "btn": {
                type: "Button",
                props: {
                    children: "Process Action",
                    size: "sm",
                    className: "bg-primary text-primary-foreground"
                }
            }
        }
    };
}
