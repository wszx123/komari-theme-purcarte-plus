import * as React from "react";

import { cn } from "@/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex w-full text-sm rounded-md bg-card px-3 py-2 placeholder:text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-0 resize-vertical min-h-[80px]",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
