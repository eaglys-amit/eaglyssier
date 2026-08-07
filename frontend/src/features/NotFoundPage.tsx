import { Compass } from "lucide-react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="p-6 pt-16">
      <EmptyState
        icon={Compass}
        title="Page not found"
        hint="The page you're looking for doesn't exist."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/projects">Back to projects</Link>
          </Button>
        }
      />
    </div>
  );
}
