/**
 * Supabase возвращает { data, error }, а не rejected Promise. Проверяем каждый результат запроса,
 * включая count/head и RPC: иначе обработчик ошибочно отвечает «успешно» при отказе записи БД.
 * Тип клиента сохраняется; Proxy оборачивает только builders from/rpc, не строки результата.
 */
export function checkedDatabase<T extends object>(client: T): T {
  const query = (builder: object): object => new Proxy(builder, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === 'then' && typeof value === 'function') {
        return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ then: value.bind(target) }).then((result: unknown) => {
            const error = (result as { error?: { code?: string; message?: string } } | null)?.error;
            if (error) {
              // Не включаем произвольный ответ БД в HTTP: детали могут содержать данные игрока.
              const failure = new Error(`Database request failed (${error.code ?? 'unknown'})`);
              Object.assign(failure, { code: error.code });
              throw failure;
            }
            return result;
          }).then(resolve, reject);
      }
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const next: unknown = value.apply(target, args);
        return next && typeof next === 'object' ? query(next) : next;
      };
    },
  });
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if ((prop === 'from' || prop === 'rpc') && typeof value === 'function') {
        return (...args: unknown[]) => query(value.apply(target, args) as object);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
