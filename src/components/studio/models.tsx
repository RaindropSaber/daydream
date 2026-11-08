"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ImagePlus,
  Clapperboard,
  FileText,
  Bot,
  SlidersHorizontal,
  Cable,
  LoaderCircle,
  CheckCircle2,
  CircleAlert,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  IMAGE_MODELS,
  imageProvider,
  TEXT_PROVIDERS,
  DEFAULT_TEXT_MODEL,
  ARK,
  wanBase,
  type ProviderCatalog,
} from "@/lib/models";
import type { Json } from "@/lib/types";
import { api, useStudio, useAction, useUnsaved } from "./context";
import { Choice, Field } from "./forms";
import { Heading } from "./common";
import { ModelPicker } from "./model-picker";

type Provider = "ark" | "wan" | "compatible";
const SERVICES = [
  {
    id: "ark" as const,
    title: "火山方舟",
    description: "连接 Seedream、Seedance，以及方舟上的文案和助手模型。",
    console: "https://ark.volcengine.com/region:cn-beijing/apikey",
  },
  {
    id: "wan" as const,
    title: "阿里云百炼",
    description:
      "连接 Qwen 图片、视频和文本模型，Key 需与所选地域和业务空间一致。",
    console: "https://bailian.console.aliyun.com/",
  },
  {
    id: "compatible" as const,
    title: "自定义兼容服务",
    description: "支持 Chat Completions 的服务，可供文案和整体助手使用。",
    console: null,
  },
];

export function Models() {
  const { config, profiles, refresh } = useStudio();
  const [module, setModule] = useState("models");
  const [models, setModels] = useState<Json>({
    image_model: config.image_model || Object.keys(IMAGE_MODELS)[0],
    model: config.video_model || Object.keys(profiles)[0],
    text_provider: config.text_provider || "ark",
    text_model: config.text_model || DEFAULT_TEXT_MODEL,
    agent_provider: config.agent_provider || config.text_provider || "ark",
    agent_model: config.agent_model || config.text_model || DEFAULT_TEXT_MODEL,
  });
  const [modelDirty, setModelDirty] = useState(false);
  const [keys, setKeys] = useState<Record<Provider, string>>({
    ark: "",
    wan: "",
    compatible: "",
  });
  const [region, setRegion] = useState(config.wan_region || "beijing");
  const [workspace, setWorkspace] = useState(config.wan_workspace || "");
  const [catalogs, setCatalogs] = useState<ProviderCatalog[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const catalogRequest = useRef(0);
  const loadCatalog = useCallback(async (force = false) => {
    const request = ++catalogRequest.current;
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const next = await api(
        `/api/settings/models/catalog${force ? "?refresh=1" : ""}`,
      );
      if (request === catalogRequest.current) setCatalogs(next.providers);
    } catch (e) {
      if (request === catalogRequest.current) {
        setCatalogs([]);
        setCatalogError(e instanceof Error ? e.message : "模型列表读取失败");
      }
    } finally {
      if (request === catalogRequest.current) setCatalogLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadCatalog();
    return () => {
      catalogRequest.current++;
    };
  }, [loadCatalog]);
  const catalogModels = catalogs.flatMap((c) => c.models);
  const [base, setBase] = useState(config.llm_base_url || "");
  const [connectionDirty, setConnectionDirty] = useState<
    Partial<Record<Provider, boolean>>
  >({});
  const [results, setResults] = useState<Partial<Record<Provider, Json>>>({});
  const [testing, setTesting] = useState<Provider | null>(null);
  const { action, busy } = useAction();
  useUnsaved(modelDirty || Object.values(connectionDirty).some(Boolean));
  const disabled = busy || !!testing;
  const configured = (provider: string) =>
    provider === "ark"
      ? config.ark_configured
      : provider === "wan"
        ? config.wan_configured
        : config.compatible_configured;
  const editModel = (field: string, value: string) => {
    setModels((old) => ({ ...old, [field]: value }));
    setModelDirty(true);
  };
  const editConnection = (provider: Provider) => {
    setConnectionDirty((old) => ({ ...old, [provider]: true }));
    setResults((old) => {
      const next = { ...old };
      delete next[provider];
      return next;
    });
  };
  const connectionBody = (provider: Provider): Json =>
    provider === "ark"
      ? { api_key: keys.ark }
      : provider === "wan"
        ? {
            wan_api_key: keys.wan,
            wan_region: region,
            wan_workspace: workspace.trim(),
          }
        : { llm_api_key: keys.compatible, llm_base_url: base.trim() };
  const saveConnection = (provider: Provider) => {
    void action(async () => {
      await api("/api/settings/models", {
        section: "connections",
        ...connectionBody(provider),
      });
      setKeys((old) => ({ ...old, [provider]: "" }));
      setConnectionDirty((old) => ({ ...old, [provider]: false }));
      await refresh();
      await loadCatalog(true);
      toast.success("服务连接已保存");
    });
  };
  const test = async (provider: Provider) => {
    setTesting(provider);
    setResults((old) => {
      const next = { ...old };
      delete next[provider];
      return next;
    });
    try {
      const result = await api("/api/settings/connections/test", {
        provider,
        api_key: keys[provider],
        ...(provider === "wan"
          ? { wan_region: region, wan_workspace: workspace.trim() }
          : {}),
        ...(provider === "compatible" ? { base_url: base.trim() } : {}),
      });
      setResults((old) => ({ ...old, [provider]: result }));
    } catch (e) {
      setResults((old) => ({
        ...old,
        [provider]: {
          ok: false,
          message: e instanceof Error ? e.message : "连接测试失败",
        },
      }));
    } finally {
      setTesting(null);
    }
  };
  const serviceBadge = (provider: string) => (
    <Badge variant="secondary">
      {configured(provider) ? "服务已配置" : "服务待配置"}
    </Badge>
  );

  return (
    <>
      <Heading title="模型管理" />
      <div
        role="tablist"
        aria-label="模型管理模块"
        className="mb-6 flex w-fit gap-1 rounded-xl border bg-muted/30 p-1"
      >
        {[
          { id: "models", title: "模型选择", Icon: SlidersHorizontal },
          { id: "connections", title: "服务连接", Icon: Cable },
        ].map(({ id, title, Icon }) => (
          <button
            key={id}
            id={`tab-${id}`}
            role="tab"
            aria-selected={module === id}
            aria-controls={`panel-${id}`}
            onClick={() => setModule(id)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm transition ${module === id ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="size-4" />
            {title}
            {(id === "models"
              ? modelDirty
              : Object.values(connectionDirty).some(Boolean)) && (
              <span
                aria-label="有未保存修改"
                className="size-1.5 rounded-full bg-primary"
              />
            )}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id="panel-models"
        aria-labelledby="tab-models"
        hidden={module !== "models"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await api("/api/settings/models", {
                section: "models",
                ...models,
              });
              setModelDirty(false);
              await refresh();
              toast.success("模型选择已保存");
            });
          }}
          className="max-w-5xl space-y-5"
        >
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">模型列表</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={catalogLoading || disabled}
                onClick={() => void loadCatalog(true)}
              >
                <RefreshCw
                  className={`size-3.5 ${catalogLoading ? "animate-spin" : ""}`}
                />
                {catalogLoading ? "拉取中…" : "刷新模型列表"}
              </Button>
            </div>
            {catalogError && (
              <p role="alert" className="text-xs text-destructive">
                {catalogError}
              </p>
            )}
            {catalogs.map((c) => (
              <div
                key={c.provider}
                className="text-xs leading-6 text-muted-foreground"
              >
                <span className="font-medium text-foreground">
                  {TEXT_PROVIDERS[c.provider]}
                </span>{" "}
                ·{" "}
                {!c.configured
                  ? "尚未配置服务连接"
                  : c.error
                    ? c.error
                    : `${c.models.length} 个可见模型 · ${c.fetched_at ? new Date(c.fetched_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""}更新`}
                {c.notice && <p>{c.notice}</p>}
              </div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ImagePlus className="size-4 text-primary" />
                  图片生成
                  <span className="ml-auto">
                    {serviceBadge(imageProvider(models.image_model) || "ark")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="图片模型">
                  <ModelPicker
                    label="图片模型"
                    disabled={disabled}
                    value={models.image_model}
                    onChange={(v) => editModel("image_model", v)}
                    entries={catalogModels}
                    role="image"
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  服务：
                  {TEXT_PROVIDERS[imageProvider(models.image_model) || "ark"]}
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clapperboard className="size-4 text-primary" />
                  视频生成
                  <span className="ml-auto">
                    {serviceBadge(
                      models.model?.startsWith("wan") ? "wan" : "ark",
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="默认视频模型">
                  <ModelPicker
                    label="默认视频模型"
                    disabled={disabled}
                    value={models.model}
                    onChange={(v) => editModel("model", v)}
                    entries={catalogModels}
                    role="video"
                  />
                </Field>
                <p className="text-xs leading-6 text-muted-foreground">
                  已有方案保留原模型，可在分集的生成设置中调整。
                </p>
              </CardContent>
            </Card>
            {[
              {
                role: "text",
                title: "文案创作",
                description: "用于整理故事、视频方案和设定集等内容草稿。",
                Icon: FileText,
              },
              {
                role: "agent",
                title: "创作助手",
                description: "用于创作助手对话。",
                Icon: Bot,
              },
            ].map(({ role, title, description, Icon }) => (
              <Card key={role} className="shadow-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4 text-primary" />
                    {title}
                    <span className="ml-auto">
                      {serviceBadge(models[`${role}_provider`])}
                    </span>
                  </CardTitle>
                  <p className="text-xs leading-6 text-muted-foreground">
                    {description}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="使用服务">
                    <Choice
                      label={`${title}服务`}
                      disabled={disabled}
                      value={models[`${role}_provider`]}
                      onChange={(v) => editModel(`${role}_provider`, v)}
                      options={TEXT_PROVIDERS}
                    />
                  </Field>
                  <Field label={manual[role] ? "手动模型 ID" : "模型"}>
                    {manual[role] ? (
                      <Input
                        aria-label={`${title}模型 ID`}
                        disabled={disabled}
                        required
                        maxLength={200}
                        value={models[`${role}_model`]}
                        placeholder="输入模型 ID"
                        onChange={(e) =>
                          editModel(`${role}_model`, e.target.value)
                        }
                      />
                    ) : (
                      <ModelPicker
                        label={`${title}模型`}
                        role="text"
                        provider={models[`${role}_provider`]}
                        entries={catalogModels}
                        value={models[`${role}_model`]}
                        disabled={disabled}
                        onChange={(id) => editModel(`${role}_model`, id)}
                      />
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="link"
                      className="h-auto px-0"
                      disabled={disabled}
                      onClick={() =>
                        setManual((old) => ({ ...old, [role]: !old[role] }))
                      }
                    >
                      {manual[role] ? "从模型列表选择" : "手动输入模型 ID"}
                    </Button>
                  </Field>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="flex justify-end">
            <Button disabled={disabled || !modelDirty}>
              {busy ? "保存中…" : "保存模型选择"}
            </Button>
          </div>
        </form>
      </section>
      <section
        role="tabpanel"
        id="panel-connections"
        aria-labelledby="tab-connections"
        hidden={module !== "connections"}
        className="max-w-5xl space-y-5"
      >
        <p className="text-sm leading-7 text-muted-foreground">
          测试连接后，需点击「保存连接」才会保存修改。
        </p>
        {SERVICES.map((service) => {
          const provider = service.id;
          const result = results[provider];
          return (
            <Card key={provider} className="shadow-none">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  {service.title}
                  {serviceBadge(provider)}
                </CardTitle>
                <p className="text-xs leading-6 text-muted-foreground">
                  {service.description}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {provider === "wan" && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label="服务地域">
                      <Choice
                        label="百炼服务地域"
                        disabled={disabled}
                        value={region}
                        onChange={(v) => {
                          setRegion(v);
                          editConnection(provider);
                        }}
                        options={{ beijing: "中国北京", singapore: "新加坡" }}
                      />
                    </Field>
                    <Field
                      label="业务空间 ID（可选）"
                      description="填入后使用专属域名，并在北京地域查询模型授权。"
                    >
                      <Input
                        aria-label="百炼业务空间 ID"
                        disabled={disabled}
                        value={workspace}
                        placeholder="控制台中的 Workspace ID"
                        onChange={(e) => {
                          setWorkspace(e.target.value);
                          editConnection(provider);
                        }}
                      />
                    </Field>
                  </div>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="API 地址">
                    <Input
                      aria-label={`${service.title} API 地址`}
                      disabled={disabled}
                      readOnly={provider !== "compatible"}
                      value={
                        provider === "ark"
                          ? ARK
                          : provider === "wan"
                            ? wanBase(region, workspace)
                            : base
                      }
                      placeholder="https://your-service.example/v1"
                      onChange={(e) => {
                        setBase(e.target.value);
                        editConnection(provider);
                      }}
                    />
                  </Field>
                  <Field label="API Key">
                    <Input
                      aria-label={`${service.title} API Key`}
                      type="password"
                      autoComplete="new-password"
                      disabled={disabled}
                      value={keys[provider]}
                      placeholder={
                        configured(provider)
                          ? "已保存，留空保留现有密钥"
                          : "输入 API Key"
                      }
                      onChange={(e) => {
                        setKeys((old) => ({
                          ...old,
                          [provider]: e.target.value,
                        }));
                        editConnection(provider);
                      }}
                    />
                  </Field>
                </div>
                {result && (
                  <div
                    role="status"
                    className={`flex items-start gap-2 rounded-lg border p-3 text-xs leading-6 ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}
                  >
                    {result.ok ? (
                      <CheckCircle2 className="mt-1 size-4 shrink-0" />
                    ) : (
                      <CircleAlert className="mt-1 size-4 shrink-0" />
                    )}
                    <div>
                      <p>{result.message}</p>
                      {result.ok && (
                        <p className="mt-1">
                          耗时 {result.latency_ms} ms · 返回{" "}
                          {result.model_count} 个模型 ·{" "}
                          {new Date(result.checked_at).toLocaleTimeString(
                            "zh-CN",
                            { hour: "2-digit", minute: "2-digit" },
                          )}{" "}
                          测试
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  {service.console ? (
                    <a
                      href={service.console}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary"
                    >
                      前往服务商控制台 ↗
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      模型需支持 JSON 格式的 Chat Completions 输出。
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        disabled ||
                        (!keys[provider] && !configured(provider)) ||
                        (provider === "compatible" && !base.trim())
                      }
                      onClick={() => void test(provider)}
                    >
                      {testing === provider && (
                        <LoaderCircle className="size-4 animate-spin" />
                      )}
                      {testing === provider ? "测试中…" : "测试连接"}
                    </Button>
                    <Button
                      type="button"
                      disabled={disabled || !connectionDirty[provider]}
                      onClick={() => saveConnection(provider)}
                    >
                      保存连接
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        <p className="pb-4 text-xs leading-6 text-muted-foreground">
          连接测试通过后，部分模型仍可能需要单独开通权限。
        </p>
      </section>
    </>
  );
}
