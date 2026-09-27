/**
 * Заготовки контента. Логика — scripts/lib/content-gen.ts (там же полный список опций), рецепты — docs/CONTENT_RECIPES.md.
 *   npm run content:new -- unit knight --from warrior       копия существующего юнита с новым id
 *   npm run content:new -- unit poring --kind monster       пустой шаблон монстра
 *   npm run content:new -- skill knight_bash --from warrior_cleave
 *   npm run content:new -- chapter chapter4 --mobs mob_melee,mob_ranged,mob_tank --boss mob_boss1   глава (10 этапов) + сюжет
 *   npm run content:new -- stage chapter4                   этап перед босс-этапом главы
 *   npm run content:new -- story chapter4                   сюжет главы (если создавали главу с --no-story)
 *   npm run content:new -- boss mob_orc_lord --from mob_boss1 --sprite boss1
 *   npm run content:new -- hero nia --class hunter --gender f                карточка героя (Таверна, редкость по классу)
 *   npm run content:new -- hero mira --class archer --gender f --story --form bard --after ch4_s10   сюжетная + рекрут
 * Заготовки проходят content:check; строки «TODO» он показывает предупреждениями — их надо дописать.
 */
import { ContentNewError, runContentNew } from './lib/content-gen';
import { ROOT } from './lib/content-node';

try {
  const r = runContentNew(process.argv.slice(2), ROOT);
  for (const f of r.written) console.log(`Создан/изменён ${f}`);
  for (const n of r.notes) console.log(`  ${n}`);
  console.log('Заполните TODO и запустите npm run content:check');
} catch (e) {
  if (!(e instanceof ContentNewError)) throw e;
  console.log(e.message);
  process.exit(1);
}
