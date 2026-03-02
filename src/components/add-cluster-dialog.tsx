import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUTH_TYPE_LABELS,
  CLUSTER_COLORS,
  type AuthType,
  type ClusterConfig,
} from "@/types/cluster";

interface AddClusterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (cluster: ClusterConfig) => void;
}

interface FormState {
  name: string;
  url: string;
  authType: AuthType;
  username: string;
  password: string;
  apiKey: string;
  token: string;
  color: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  url: "",
  authType: "none",
  username: "",
  password: "",
  apiKey: "",
  token: "",
  color: CLUSTER_COLORS[0],
};

export function AddClusterDialog({
  open,
  onOpenChange,
  onAdd,
}: AddClusterDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit = form.name.trim() !== "" && form.url.trim() !== "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const base = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      url: form.url.trim().replace(/\/+$/, ""),
      color: form.color,
    };

    let cluster: ClusterConfig;
    switch (form.authType) {
      case "basic":
        cluster = { ...base, auth: { type: "basic", username: form.username, password: form.password } };
        break;
      case "apikey":
        cluster = { ...base, auth: { type: "apikey", apiKey: form.apiKey } };
        break;
      case "bearer":
        cluster = { ...base, auth: { type: "bearer", token: form.token } };
        break;
      default:
        cluster = { ...base, auth: { type: "none" } };
    }

    onAdd(cluster);
    setForm(INITIAL_FORM);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setForm(INITIAL_FORM);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Cluster</DialogTitle>
            <DialogDescription>
              Connect to an Elasticsearch cluster.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Name */}
            <div className="grid gap-1.5">
              <label htmlFor="cluster-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="cluster-name"
                placeholder="Production"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                autoFocus
              />
            </div>

            {/* URL */}
            <div className="grid gap-1.5">
              <label htmlFor="cluster-url" className="text-sm font-medium">
                URL
              </label>
              <Input
                id="cluster-url"
                placeholder="https://localhost:9200"
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
              />
            </div>

            {/* Color picker */}
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Color</span>
              <div className="flex gap-2">
                {CLUSTER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="size-6 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: form.color === c ? "white" : "transparent",
                      boxShadow: form.color === c ? `0 0 0 2px ${c}` : "none",
                    }}
                    onClick={() => set("color", c)}
                    aria-label={`Select color ${c}`}
                  />
                ))}
              </div>
            </div>

            {/* Auth type */}
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Authentication</label>
              <Select
                value={form.authType}
                onValueChange={(v) => set("authType", v as AuthType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(AUTH_TYPE_LABELS) as [AuthType, string][]).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Auth fields — rendered conditionally */}
            {form.authType === "basic" && (
              <>
                <div className="grid gap-1.5">
                  <label htmlFor="auth-username" className="text-sm font-medium">
                    Username
                  </label>
                  <Input
                    id="auth-username"
                    placeholder="elastic"
                    value={form.username}
                    onChange={(e) => set("username", e.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="auth-password" className="text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="auth-password"
                    type="password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              </>
            )}

            {form.authType === "apikey" && (
              <div className="grid gap-1.5">
                <label htmlFor="auth-apikey" className="text-sm font-medium">
                  API Key
                </label>
                <Input
                  id="auth-apikey"
                  type="password"
                  placeholder="Base64-encoded API key"
                  value={form.apiKey}
                  onChange={(e) => set("apiKey", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The base64-encoded <code>id:api_key</code> value.
                </p>
              </div>
            )}

            {form.authType === "bearer" && (
              <div className="grid gap-1.5">
                <label htmlFor="auth-bearer" className="text-sm font-medium">
                  Bearer Token
                </label>
                <Input
                  id="auth-bearer"
                  type="password"
                  placeholder="Token"
                  value={form.token}
                  onChange={(e) => set("token", e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Add Cluster
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
