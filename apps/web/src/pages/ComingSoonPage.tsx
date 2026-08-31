import { Link } from "react-router-dom";
import { Construction } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DISABLED_FEATURES, type DisabledFeatureKey } from "@/lib/disabledFeatures";

export function ComingSoonPage({ feature }: { feature: DisabledFeatureKey }) {
  const { title, description } = DISABLED_FEATURES[feature];

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader title={title} description="Temporarily unavailable" />
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <Construction className="size-7" />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-semibold">Coming Soon</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
