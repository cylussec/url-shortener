export type Bindings = Env;

export type Variables = {
  userId: number;
  tokenHash: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
