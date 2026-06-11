import type { PostRepository } from './repository.js';
import type { Post } from './schema.js';

const FBAR_EN = `## What is the FBAR?

The FBAR is the Report of Foreign Bank and Financial Accounts, filed as FinCEN Form 114. It is not filed with Form 1040. It is submitted electronically and is used to report certain foreign financial accounts when the total value of those accounts goes above the reporting threshold.

For many taxpayers, the problem is not that the rule is intentionally ignored. The problem is that people move countries, keep savings abroad, have signing authority over family or business accounts, or maintain a pension in another country and do not realize that a U.S. reporting obligation may exist.

<div class="blog-callout">
  <strong>Key point:</strong> the FBAR is about reporting foreign financial accounts. It does not automatically mean additional tax is due, but failing to file it can create serious penalty exposure.
</div>

## Who usually needs to file?

A U.S. person may need to file an FBAR when both of these conditions apply:

- They have a financial interest in, signature authority over, or other authority over one or more financial accounts outside the United States.
- The aggregate maximum value of all foreign financial accounts exceeded $10,000 at any point during the calendar year.

The $10,000 threshold is not applied account by account. It is applied to the combined value of all reportable foreign accounts. For example, three accounts with maximum values of $4,000, $3,500 and $3,000 can trigger an FBAR because the combined value is over $10,000.

## Accounts that can be reportable

The most common examples are foreign checking accounts, savings accounts, brokerage accounts and investment accounts. Depending on the facts, reporting may also apply to foreign mutual funds, certain life insurance policies with cash value, foreign pension arrangements and accounts where the taxpayer only has signature authority.

Joint accounts are a common source of confusion. If a taxpayer owns a joint account, the FBAR generally reports the maximum value of the whole account, not only the taxpayer’s percentage share.

## What information is reported?

A complete FBAR normally includes the financial institution name, account number, account type, country, and the maximum value reached during the year. If the account is held in a foreign currency, the value must be converted into U.S. dollars using an accepted year-end exchange rate.

This is why good recordkeeping matters. Bank statements, investment statements and pension statements should be kept together before preparing the filing.

## When is it due?

The annual FBAR due date is April 15 following the calendar year reported. If it is not filed by April 15, there is an automatic extension to October 15. No separate extension form is required.

## What happens if the FBAR was missed?

The best response depends on the facts. A taxpayer who missed one year by mistake is in a different position from someone who knowingly avoided disclosure for several years. The IRS and FinCEN distinguish between non-willful and willful conduct, and the penalty risk can be very different.

In many cases, taxpayers should avoid simply filing old FBARs quietly without reviewing the full situation. If foreign income was also omitted from U.S. tax returns, amended returns or a formal compliance procedure may be needed.

## Practical checklist

Before filing, gather:

- All foreign bank and investment account statements.
- Maximum balances for each account during the year.
- Ownership details and signature authority details.
- Any foreign pension or life insurance information.
- Copies of prior U.S. tax returns to check whether foreign income was reported.

## How Taxalia can help

Taxalia can review whether an FBAR is required, organize the account information, identify related forms such as Form 8938, and help choose the safest correction route when past filings were missed.

<p class="blog-source-note">Official reference: <a href="https://www.irs.gov/businesses/small-businesses-self-employed/report-of-foreign-bank-and-financial-accounts-fbar" target="_blank" rel="noopener noreferrer">IRS FBAR guidance</a>.</p>
`;

const FBAR_ES = `## Qué es el FBAR

El FBAR es el Report of Foreign Bank and Financial Accounts, presentado como FinCEN Form 114. No se presenta junto con el Form 1040. Se envía de forma electrónica y sirve para declarar determinadas cuentas financieras situadas fuera de Estados Unidos cuando el valor total supera el umbral de declaración.

En muchos casos, el problema no es que el contribuyente quiera ocultar información. El problema suele aparecer cuando una persona se muda de país, mantiene ahorros en el extranjero, tiene autorización de firma sobre cuentas familiares o de empresa, o conserva un plan de pensiones en otro país y no sabe que puede existir una obligación de reporte en Estados Unidos.

<div class="blog-callout">
  <strong>Idea clave:</strong> el FBAR informa sobre cuentas financieras extranjeras. No significa necesariamente que haya más impuesto que pagar, pero no presentarlo puede generar sanciones importantes.
</div>

## Quién suele tener que presentarlo

Una U.S. person puede tener que presentar FBAR cuando se cumplen estas dos condiciones:

- Tiene interés financiero, autoridad de firma u otro tipo de control sobre una o varias cuentas financieras fuera de Estados Unidos.
- El valor máximo agregado de todas las cuentas financieras extranjeras superó los $10,000 en algún momento del año natural.

El límite de $10,000 no se aplica cuenta por cuenta. Se aplica al valor combinado de todas las cuentas reportables. Por ejemplo, tres cuentas con valores máximos de $4,000, $3,500 y $3,000 pueden obligar a presentar FBAR porque el total supera los $10,000.

## Cuentas que pueden ser reportables

Los ejemplos más habituales son cuentas corrientes, cuentas de ahorro, cuentas de inversión y cuentas de valores en el extranjero. Según el caso, también pueden entrar fondos de inversión extranjeros, determinados seguros de vida con valor de rescate, pensiones extranjeras y cuentas en las que el contribuyente solo tiene autoridad de firma.

Las cuentas conjuntas generan muchas dudas. Si el contribuyente es cotitular de una cuenta, normalmente se reporta el valor máximo total de la cuenta, no solo el porcentaje que le corresponde.

## Qué información se declara

Un FBAR completo suele incluir el nombre de la entidad financiera, número de cuenta, tipo de cuenta, país y valor máximo alcanzado durante el año. Si la cuenta está en otra moneda, el valor debe convertirse a dólares estadounidenses usando un tipo de cambio aceptado.

Por eso es importante conservar bien la documentación. Conviene reunir extractos bancarios, extractos de inversión y documentación de pensiones antes de preparar la declaración.

## Cuándo se presenta

La fecha anual de vencimiento del FBAR es el 15 de abril siguiente al año natural declarado. Si no se presenta antes del 15 de abril, existe una extensión automática hasta el 15 de octubre. No hay que presentar un formulario separado para pedir esa extensión.

## Qué ocurre si no se presentó

La mejor solución depende de los hechos. No es lo mismo olvidar un año por desconocimiento que haber evitado conscientemente declarar durante varios años. El IRS y FinCEN diferencian entre conducta no intencional y conducta intencional, y el riesgo de sanción cambia mucho.

En muchos casos no conviene presentar FBARs antiguos de forma aislada sin revisar antes la situación completa. Si además se omitieron ingresos extranjeros en declaraciones de impuestos de Estados Unidos, puede ser necesario presentar declaraciones corregidas o utilizar un procedimiento formal de regularización.

## Lista práctica antes de empezar

Antes de presentar, reúne:

- Extractos de todas las cuentas bancarias y de inversión extranjeras.
- Saldos máximos de cada cuenta durante el año.
- Datos de titularidad y de autoridad de firma.
- Información de pensiones extranjeras o seguros de vida si existen.
- Copias de declaraciones fiscales anteriores para revisar si se declaró la renta extranjera.

## Cómo puede ayudar Taxalia

Taxalia puede revisar si existe obligación de presentar FBAR, ordenar la información de cuentas, detectar formularios relacionados como el Form 8938 y valorar la vía más segura si hay años anteriores sin declarar.

<p class="blog-source-note">Referencia oficial: <a href="https://www.irs.gov/businesses/small-businesses-self-employed/report-of-foreign-bank-and-financial-accounts-fbar" target="_blank" rel="noopener noreferrer">guía FBAR del IRS</a>.</p>
`;

const FTC_EN = `## Why the foreign tax credit exists

U.S. taxpayers are generally taxed on worldwide income. That means income earned outside the United States can still appear on a U.S. tax return. When the same income has already been taxed by another country, the foreign tax credit may help reduce double taxation.

The credit is usually claimed on Form 1116 for individuals. It does not erase the need to report the income. Instead, it helps offset U.S. tax on foreign-source income when the taxpayer paid or accrued qualifying foreign income taxes.

<div class="blog-callout">
  <strong>Key point:</strong> the foreign tax credit is not simply a refund of taxes paid abroad. It is limited by U.S. rules and must be calculated by income category.
</div>

## Credit or deduction?

Foreign taxes may sometimes be taken as either a credit or an itemized deduction. In many cases, the credit is more valuable because it directly reduces U.S. tax liability. A deduction only reduces taxable income.

However, the best choice depends on the taxpayer’s income, filing position, type of foreign tax paid and other deductions available. This should be reviewed year by year.

## The limitation rule

The foreign tax credit is generally limited to the smaller of:

- The qualifying foreign taxes paid or accrued, or
- The U.S. tax attributable to the foreign-source income.

This prevents the credit from offsetting U.S. tax on income that is not foreign-source income. It also means that paying a high tax rate abroad does not always produce a full dollar-for-dollar credit in the United States.

## Income categories matter

Foreign tax credits are separated into categories, often called baskets. Employment income is commonly treated as general category income, while interest, dividends and certain investment income may fall into the passive category.

These categories normally do not mix freely. Excess credit from one category may not be available to offset tax in another category. This is one reason the calculation can become more complex than expected.

## Interaction with the foreign earned income exclusion

Some taxpayers living abroad also consider the Foreign Earned Income Exclusion. This can exclude a portion of earned income from U.S. tax, but there is no double benefit. Foreign taxes connected to excluded income generally cannot also be used for the foreign tax credit.

Choosing between exclusion, credit, or a combination of both can change the final tax result, especially for taxpayers in countries with higher income tax rates.

## What records should be kept?

Good documentation is essential. Taxpayers should keep:

- Foreign tax returns.
- Payment receipts or withholding certificates.
- Payslips showing foreign tax withheld.
- Exchange rate support.
- Statements separating earned income, investment income and other income types.

## Common mistakes

The most common errors are claiming taxes that do not qualify, mixing income categories, claiming credit on income already excluded, or forgetting that unused credits may need to be tracked for possible carryover.

## How Taxalia can help

Taxalia can review whether the foreign tax credit applies, organize foreign tax documentation, compare the credit with other options, and prepare a filing position that reduces double taxation without creating unnecessary IRS risk.

<p class="blog-source-note">Official reference: <a href="https://www.irs.gov/individuals/international-taxpayers/foreign-tax-credit" target="_blank" rel="noopener noreferrer">IRS foreign tax credit guidance</a>.</p>
`;

const FTC_ES = `## Por qué existe el crédito por impuestos extranjeros

Los contribuyentes estadounidenses suelen tributar por su renta mundial. Eso significa que los ingresos obtenidos fuera de Estados Unidos pueden tener que aparecer igualmente en la declaración fiscal estadounidense. Cuando esa misma renta ya ha pagado impuestos en otro país, el foreign tax credit puede ayudar a reducir la doble imposición.

En personas físicas, el crédito suele reclamarse mediante el Form 1116. No elimina la obligación de declarar el ingreso. Lo que hace es compensar, dentro de ciertos límites, el impuesto estadounidense asociado a renta de fuente extranjera cuando se han pagado o devengado impuestos extranjeros cualificados.

<div class="blog-callout">
  <strong>Idea clave:</strong> el foreign tax credit no es simplemente una devolución automática de lo pagado fuera. Está limitado por normas estadounidenses y debe calcularse por categorías de renta.
</div>

## Crédito o deducción

En algunos casos, los impuestos extranjeros pueden tratarse como crédito o como deducción detallada. Muchas veces el crédito es más útil porque reduce directamente la cuota del impuesto en Estados Unidos. La deducción solo reduce la base imponible.

Aun así, la mejor opción depende de los ingresos del contribuyente, su situación de filing, el tipo de impuesto extranjero pagado y otras deducciones disponibles. Conviene revisarlo año a año.

## La regla de limitación

El foreign tax credit suele limitarse al menor de estos importes:

- Los impuestos extranjeros cualificados pagados o devengados.
- El impuesto estadounidense atribuible a la renta de fuente extranjera.

Esta regla evita que el crédito compense impuesto estadounidense generado por renta que no es extranjera. También significa que pagar un tipo alto fuera de Estados Unidos no siempre produce un crédito completo dólar por dólar.

## Las categorías de renta importan

Los créditos por impuestos extranjeros se separan en categorías, conocidas habitualmente como baskets. La renta del trabajo suele ir a la categoría general, mientras que intereses, dividendos y ciertas rentas de inversión pueden ir a la categoría pasiva.

Estas categorías normalmente no se mezclan libremente. Un exceso de crédito en una categoría puede no servir para compensar impuesto en otra. Por eso el cálculo puede ser más complejo de lo que parece.

## Relación con la exclusión de ingresos extranjeros

Algunos contribuyentes que viven fuera de Estados Unidos también valoran la Foreign Earned Income Exclusion. Esta exclusión permite dejar fuera una parte de la renta del trabajo, pero no se puede duplicar el beneficio. Los impuestos extranjeros vinculados a renta excluida normalmente no pueden usarse también como foreign tax credit.

Elegir exclusión, crédito o una combinación de ambos puede cambiar mucho el resultado, especialmente en países con tipos de impuesto sobre la renta más altos.

## Qué documentación conviene guardar

La documentación es clave. El contribuyente debería conservar:

- Declaraciones fiscales extranjeras.
- Justificantes de pago o certificados de retención.
- Nóminas con impuestos extranjeros retenidos.
- Soporte del tipo de cambio utilizado.
- Extractos que separen renta del trabajo, inversión y otros tipos de ingresos.

## Errores habituales

Los errores más frecuentes son reclamar impuestos que no califican, mezclar categorías de renta, usar el crédito sobre ingresos ya excluidos o no llevar control de créditos no utilizados que podrían trasladarse a otros años.

## Cómo puede ayudar Taxalia

Taxalia puede revisar si el foreign tax credit aplica, ordenar la documentación fiscal extranjera, comparar el crédito con otras opciones y preparar una posición fiscal que reduzca la doble imposición sin crear riesgos innecesarios frente al IRS.

<p class="blog-source-note">Referencia oficial: <a href="https://www.irs.gov/individuals/international-taxpayers/foreign-tax-credit" target="_blank" rel="noopener noreferrer">guía del IRS sobre foreign tax credit</a>.</p>
`;

const TREATY_EN = `## What is an income tax treaty?

An income tax treaty is an agreement between two countries that can affect how certain income is taxed. Treaties may reduce withholding, assign taxing rights, prevent double taxation, or provide special rules for pensions, business profits, real estate income, royalties, dividends, interest and other categories of income.

For U.S. taxpayers with cross-border facts, treaty analysis can be useful, but it must be handled carefully. A treaty benefit is not automatic just because two countries have a treaty.

<div class="blog-callout">
  <strong>Key point:</strong> a tax treaty can reduce or change taxation, but the exact result depends on residency, income type, treaty wording and disclosure requirements.
</div>

## Treaty residency comes first

The first question is usually whether the taxpayer is a resident of one or both countries under domestic law and under the treaty. Some people are residents of two countries at the same time under local rules. In those cases, the treaty may include tie-breaker rules.

Treaty residency is especially important for green card holders, dual residents, remote workers, business owners and people who moved during the year.

## The saving clause

Many U.S. tax treaties include a saving clause. In simple terms, this clause often allows the United States to tax its citizens or residents as if the treaty had not come into effect, except for specific treaty exceptions.

This is one of the main reasons treaty claims should not be made casually. A benefit that works for a nonresident alien may not work the same way for a U.S. citizen or resident.

## Common treaty areas

Tax treaties can affect:

- Wages and self-employment income.
- Dividends, interest and royalties.
- Pension distributions and social security type income.
- Rental income and real estate gains.
- Business profits and permanent establishment analysis.
- Student, teacher or researcher income.

Some countries also have estate tax treaties with the United States, and separate totalization agreements may affect social security taxes.

## Form 8833 and disclosure

When a taxpayer takes a treaty-based return position that modifies or overrides the normal Internal Revenue Code treatment, Form 8833 may be required. Failing to disclose a treaty position when required can create penalties even if the technical position is reasonable.

Not every treaty benefit requires Form 8833, but the disclosure rule should always be checked before filing.

## State taxes may be different

Another frequent issue is state taxation. Some U.S. states do not fully follow federal treaty treatment. A taxpayer may receive a federal treaty benefit and still have state-level tax exposure.

## How Taxalia can help

Taxalia can review the relevant treaty article, determine whether a benefit is available, check whether Form 8833 is required, and coordinate the treaty position with foreign tax credits, FBAR, FATCA and state tax issues.

<p class="blog-source-note">Official references: <a href="https://www.irs.gov/individuals/international-taxpayers/tax-treaties" target="_blank" rel="noopener noreferrer">IRS tax treaties</a> and <a href="https://www.irs.gov/forms-pubs/about-form-8833" target="_blank" rel="noopener noreferrer">Form 8833</a>.</p>
`;

const TREATY_ES = `## Qué es un convenio fiscal

Un convenio fiscal sobre la renta es un acuerdo entre dos países que puede afectar a cómo se grava determinada renta. Los convenios pueden reducir retenciones, asignar derechos de imposición, evitar doble imposición o establecer reglas especiales para pensiones, beneficios empresariales, rentas inmobiliarias, royalties, dividendos, intereses y otros tipos de ingresos.

Para contribuyentes con situaciones internacionales, analizar el convenio puede ser muy útil, pero debe hacerse con cuidado. El beneficio de un convenio no se aplica automáticamente solo porque exista un tratado entre dos países.

<div class="blog-callout">
  <strong>Idea clave:</strong> un convenio fiscal puede reducir o modificar la tributación, pero el resultado depende de la residencia, el tipo de renta, el texto del convenio y las obligaciones de disclosure.
</div>

## Primero hay que revisar la residencia fiscal

La primera pregunta suele ser si el contribuyente es residente de uno o de ambos países según la ley interna y según el convenio. Algunas personas pueden ser residentes de dos países al mismo tiempo bajo las normas locales. En esos casos, el convenio puede incluir reglas de desempate.

La residencia por convenio es especialmente importante para green card holders, residentes duales, trabajadores remotos, empresarios y personas que se mudaron durante el año.

## La saving clause

Muchos convenios fiscales de Estados Unidos incluyen una saving clause. De forma sencilla, esta cláusula suele permitir que Estados Unidos grave a sus ciudadanos o residentes como si el convenio no existiera, salvo excepciones concretas previstas en el propio tratado.

Por eso no conviene reclamar beneficios de convenio de forma automática. Un beneficio que funciona para un nonresident alien puede no funcionar igual para un ciudadano o residente estadounidense.

## Áreas habituales de los convenios

Los convenios pueden afectar a:

- Salarios y renta del trabajo por cuenta propia.
- Dividendos, intereses y royalties.
- Pensiones y rentas similares a seguridad social.
- Alquileres y ganancias por bienes inmuebles.
- Beneficios empresariales y análisis de establecimiento permanente.
- Rentas de estudiantes, profesores o investigadores.

Algunos países también tienen convenios de impuesto sobre sucesiones con Estados Unidos, y los totalization agreements separados pueden afectar a impuestos de seguridad social.

## Form 8833 y obligación de disclosure

Cuando el contribuyente adopta una posición basada en convenio que modifica o sustituye el tratamiento normal del Internal Revenue Code, puede ser necesario presentar Form 8833. No revelar una posición de convenio cuando corresponde puede generar sanciones aunque la posición técnica sea razonable.

No todos los beneficios de convenio exigen Form 8833, pero la obligación de disclosure debe revisarse siempre antes de presentar.

## Los impuestos estatales pueden ser distintos

Otro punto frecuente es la tributación estatal. Algunos estados de Estados Unidos no siguen completamente el tratamiento federal de los convenios. Por tanto, un contribuyente puede tener un beneficio federal y aun así mantener exposición fiscal a nivel estatal.

## Cómo puede ayudar Taxalia

Taxalia puede revisar el artículo concreto del convenio, determinar si el beneficio está disponible, comprobar si hay que presentar Form 8833 y coordinar la posición de convenio con foreign tax credits, FBAR, FATCA e impuestos estatales.

<p class="blog-source-note">Referencias oficiales: <a href="https://www.irs.gov/individuals/international-taxpayers/tax-treaties" target="_blank" rel="noopener noreferrer">convenios fiscales del IRS</a> y <a href="https://www.irs.gov/forms-pubs/about-form-8833" target="_blank" rel="noopener noreferrer">Form 8833</a>.</p>
`;

const STREAMLINED_EN = `## What are the streamlined procedures?

The Streamlined Filing Compliance Procedures are IRS procedures for certain individual taxpayers who failed to report foreign financial assets, file required international forms, or pay tax connected with those assets, when the failure was non-willful.

They are designed for taxpayers who need to come back into compliance but whose conduct was due to negligence, mistake, misunderstanding, or a good-faith misinterpretation of the rules.

<div class="blog-callout">
  <strong>Key point:</strong> streamlined filing is only for non-willful conduct. If the facts suggest willfulness, a different voluntary disclosure route may be needed.
</div>

## Two different tracks

There are two main streamlined tracks:

- Streamlined Domestic Offshore Procedures for eligible taxpayers residing in the United States.
- Streamlined Foreign Offshore Procedures for eligible taxpayers residing outside the United States.

The right track matters because the penalty treatment and filing requirements are not identical.

## Domestic streamlined filing

The domestic track is generally for taxpayers who live in the United States and previously filed timely U.S. tax returns but failed to report foreign income, foreign accounts, or required international information forms.

A domestic streamlined submission generally involves amended returns for the most recent three years, FBARs for the most recent six years, tax and interest, a signed non-willfulness certification, and a 5% miscellaneous offshore penalty calculated under the streamlined rules.

## Foreign streamlined filing

The foreign track is generally for taxpayers who qualify as residing outside the United States. This track may allow original or amended returns, six years of FBARs, a signed non-willfulness certification, and payment of tax and interest due. Qualifying foreign streamlined taxpayers are not subject to the Title 26 miscellaneous offshore penalty.

One common requirement for U.S. citizens or lawful permanent residents is meeting the non-residency requirement, often involving at least 330 full days outside the United States in at least one of the relevant three years.

## Non-willfulness is the center of the case

The certification is not a formality. The taxpayer must explain why the noncompliance was non-willful. A strong explanation usually connects the facts: where the taxpayer lived, what they knew, who prepared the returns, what documents were provided, and when the taxpayer discovered the issue.

A weak or inaccurate narrative can create risk. The submission should be truthful, complete and consistent with the records.

## When streamlined may not be available

Streamlined procedures may not be available if the IRS has already started a civil examination for any tax year, or if the taxpayer is trying to resolve willful conduct. Previous penalty assessments can also change the analysis.

Taxpayers should also be careful with quiet disclosures, meaning simply filing amended returns or late FBARs outside a formal procedure without addressing the compliance issue properly.

## How Taxalia can help

Taxalia can review eligibility, identify the correct track, prepare the filing package, organize FBAR and FATCA data, calculate tax and interest, and draft a clear non-willfulness narrative supported by the facts.

<p class="blog-source-note">Official reference: <a href="https://www.irs.gov/individuals/international-taxpayers/streamlined-filing-compliance-procedures" target="_blank" rel="noopener noreferrer">IRS streamlined filing compliance procedures</a>.</p>
`;

const STREAMLINED_ES = `## Qué son los procedimientos streamlined

Los Streamlined Filing Compliance Procedures son procedimientos del IRS para determinados contribuyentes individuales que no reportaron activos financieros extranjeros, no presentaron formularios internacionales obligatorios o no pagaron impuestos relacionados con esos activos, siempre que el incumplimiento no haya sido intencional.

Están pensados para contribuyentes que necesitan ponerse al día y cuya conducta se debió a negligencia, error, desconocimiento o una interpretación de buena fe de las normas.

<div class="blog-callout">
  <strong>Idea clave:</strong> streamlined solo sirve para conducta no intencional. Si los hechos apuntan a willfulness, puede ser necesaria otra vía de voluntary disclosure.
</div>

## Dos vías distintas

Existen dos vías principales:

- Streamlined Domestic Offshore Procedures para contribuyentes elegibles que residen en Estados Unidos.
- Streamlined Foreign Offshore Procedures para contribuyentes elegibles que residen fuera de Estados Unidos.

Elegir bien la vía es importante porque el tratamiento de sanciones y los requisitos no son idénticos.

## Streamlined domestic

La vía domestic suele aplicar a contribuyentes que viven en Estados Unidos y que habían presentado declaraciones fiscales a tiempo, pero no reportaron renta extranjera, cuentas extranjeras o formularios internacionales obligatorios.

Una presentación domestic normalmente incluye declaraciones corregidas de los tres años más recientes, FBARs de los seis años más recientes, impuesto e intereses, una certificación firmada de conducta no intencional y una sanción offshore miscelánea del 5% calculada según las reglas streamlined.

## Streamlined foreign

La vía foreign suele aplicar a contribuyentes que califican como residentes fuera de Estados Unidos. Esta vía puede permitir presentar declaraciones originales o corregidas, seis años de FBARs, una certificación firmada de conducta no intencional y el pago del impuesto e intereses pendientes. Los contribuyentes que califican para foreign streamlined no están sujetos a la sanción offshore miscelánea de Title 26.

Un requisito habitual para ciudadanos estadounidenses o lawful permanent residents es cumplir la regla de no residencia, normalmente vinculada a haber estado al menos 330 días completos fuera de Estados Unidos en al menos uno de los tres años relevantes.

## La conducta no intencional es el centro del caso

La certificación no es un simple trámite. El contribuyente debe explicar por qué el incumplimiento fue no intencional. Una buena explicación conecta los hechos: dónde vivía el contribuyente, qué sabía, quién preparaba las declaraciones, qué documentos se entregaron y cuándo descubrió el problema.

Una narrativa débil o incorrecta puede crear riesgo. La presentación debe ser veraz, completa y coherente con los documentos.

## Cuándo puede no estar disponible

Los procedimientos streamlined pueden no estar disponibles si el IRS ya ha iniciado una inspección civil para cualquier año fiscal, o si el contribuyente intenta resolver una conducta intencional. La existencia de sanciones ya impuestas también puede cambiar el análisis.

También hay que tener cuidado con las quiet disclosures, es decir, presentar declaraciones corregidas o FBARs atrasados fuera de un procedimiento formal sin tratar correctamente el problema de cumplimiento.

## Cómo puede ayudar Taxalia

Taxalia puede revisar la elegibilidad, identificar la vía correcta, preparar el paquete de presentación, organizar datos FBAR y FATCA, calcular impuesto e intereses y redactar una narrativa clara de conducta no intencional apoyada en los hechos.

<p class="blog-source-note">Referencia oficial: <a href="https://www.irs.gov/individuals/international-taxpayers/streamlined-filing-compliance-procedures" target="_blank" rel="noopener noreferrer">procedimientos streamlined del IRS</a>.</p>
`;

const LEGACY_POSTS_TO_HIDE: Post[] = [
  {
    slug: 'multimedia-post-example',
    lang: 'en',
    translationKey: 'multimedia-post',
    title: 'Multimedia post example',
    description: 'Hidden legacy example post.',
    bodyMd: '',
    author: 'Taxalia',
    heroImage: null,
    heroAlt: null,
    tags: ['Hidden'],
    draft: true,
    pubDate: '2026-06-09',
    updatedDate: '2026-06-10',
  },
  {
    slug: 'ejemplo-post-multimedia',
    lang: 'es',
    translationKey: 'multimedia-post',
    title: 'Ejemplo de post multimedia',
    description: 'Artículo antiguo oculto.',
    bodyMd: '',
    author: 'Taxalia',
    heroImage: null,
    heroAlt: null,
    tags: ['Oculto'],
    draft: true,
    pubDate: '2026-06-09',
    updatedDate: '2026-06-10',
  },
  {
    slug: 'business-valuation-101',
    lang: 'en',
    translationKey: 'valuation-101',
    title: 'Business Valuation 101',
    description: 'Hidden legacy valuation post.',
    bodyMd: '',
    author: 'Taxalia',
    heroImage: null,
    heroAlt: null,
    tags: ['Hidden'],
    draft: true,
    pubDate: '2026-05-20',
    updatedDate: '2026-06-10',
  },
  {
    slug: 'valoracion-de-empresas-101',
    lang: 'es',
    translationKey: 'valuation-101',
    title: 'Valoración de empresas 101',
    description: 'Artículo antiguo oculto.',
    bodyMd: '',
    author: 'Taxalia',
    heroImage: null,
    heroAlt: null,
    tags: ['Oculto'],
    draft: true,
    pubDate: '2026-05-20',
    updatedDate: '2026-06-10',
  },
];

const SEED_POSTS: Post[] = [
  {
    slug: 'fbar-foreign-bank-accounts',
    lang: 'en',
    translationKey: 'fbar-foreign-bank-accounts',
    title: 'FBAR: reporting foreign bank and financial accounts',
    description:
      'A practical guide to when U.S. taxpayers may need to file FinCEN Form 114 for foreign financial accounts.',
    bodyMd: FBAR_EN,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/fbar-foreign-accounts.webp',
    heroAlt: 'Tax forms and calculator arranged on a desk',
    tags: ['FBAR', 'Foreign Accounts', 'Compliance'],
    draft: false,
    pubDate: '2024-03-18',
    updatedDate: '2024-03-18',
  },
  {
    slug: 'fbar-cuentas-bancarias-extranjeras',
    lang: 'es',
    translationKey: 'fbar-foreign-bank-accounts',
    title: 'FBAR: cómo declarar cuentas bancarias y financieras extranjeras',
    description:
      'Guía práctica para entender cuándo un contribuyente estadounidense puede tener que presentar FinCEN Form 114.',
    bodyMd: FBAR_ES,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/fbar-foreign-accounts.webp',
    heroAlt: 'Formularios fiscales y calculadora sobre una mesa',
    tags: ['FBAR', 'Cuentas extranjeras', 'Compliance'],
    draft: false,
    pubDate: '2024-03-18',
    updatedDate: '2024-03-18',
  },
  {
    slug: 'foreign-tax-credit-guide',
    lang: 'en',
    translationKey: 'foreign-tax-credit-guide',
    title: 'Foreign tax credit: avoiding double taxation',
    description:
      'How the foreign tax credit can reduce double taxation when foreign income is also taxed in the United States.',
    bodyMd: FTC_EN,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/foreign-tax-credit.webp',
    heroAlt: 'U.S. tax forms with calculator and pen',
    tags: ['Foreign Tax Credit', 'Form 1116', 'International Tax'],
    draft: false,
    pubDate: '2024-11-07',
    updatedDate: '2024-11-07',
  },
  {
    slug: 'credito-impuestos-extranjeros',
    lang: 'es',
    translationKey: 'foreign-tax-credit-guide',
    title: 'Foreign tax credit: cómo evitar la doble imposición',
    description:
      'Cómo el crédito por impuestos extranjeros puede reducir la doble imposición cuando una renta extranjera también tributa en Estados Unidos.',
    bodyMd: FTC_ES,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/foreign-tax-credit.webp',
    heroAlt: 'Formularios fiscales estadounidenses con calculadora y bolígrafo',
    tags: ['Foreign Tax Credit', 'Form 1116', 'Fiscalidad internacional'],
    draft: false,
    pubDate: '2024-11-07',
    updatedDate: '2024-11-07',
  },
  {
    slug: 'income-tax-treaty-benefits',
    lang: 'en',
    translationKey: 'income-tax-treaty-benefits',
    title: 'Income tax treaties: when they help and when they do not',
    description:
      'A clear explanation of how tax treaties may affect cross-border income, disclosure and treaty-based return positions.',
    bodyMd: TREATY_EN,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/tax-treaty-benefits.webp',
    heroAlt: 'Tax documents, phone calculator and coffee on a desk',
    tags: ['Tax Treaty', 'Form 8833', 'Cross-Border Tax'],
    draft: false,
    pubDate: '2025-08-22',
    updatedDate: '2025-08-22',
  },
  {
    slug: 'convenios-fiscales-eeuu',
    lang: 'es',
    translationKey: 'income-tax-treaty-benefits',
    title: 'Convenios fiscales con Estados Unidos: cuándo ayudan y cuándo no',
    description:
      'Explicación clara de cómo un convenio fiscal puede afectar rentas internacionales, disclosures y posiciones basadas en tratado.',
    bodyMd: TREATY_ES,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/tax-treaty-benefits.webp',
    heroAlt: 'Documentos fiscales, calculadora del móvil y café sobre una mesa',
    tags: ['Convenios fiscales', 'Form 8833', 'Fiscalidad internacional'],
    draft: false,
    pubDate: '2025-08-22',
    updatedDate: '2025-08-22',
  },
  {
    slug: 'streamlined-filing-compliance-procedures',
    lang: 'en',
    translationKey: 'streamlined-filing-compliance-procedures',
    title: 'Streamlined filing compliance procedures: getting back into compliance',
    description:
      'What non-willful taxpayers should know about the IRS streamlined domestic and foreign offshore procedures.',
    bodyMd: STREAMLINED_EN,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/streamlined-filing-compliance.webp',
    heroAlt: 'Tax forms and calculator in a folder on a dark desk',
    tags: ['Streamlined Filing', 'Offshore Compliance', 'FBAR'],
    draft: false,
    pubDate: '2026-02-14',
    updatedDate: '2026-02-14',
  },
  {
    slug: 'procedimientos-streamlined-compliance',
    lang: 'es',
    translationKey: 'streamlined-filing-compliance-procedures',
    title: 'Procedimientos streamlined: cómo volver a estar en cumplimiento',
    description:
      'Qué deben saber los contribuyentes no intencionales sobre las vías streamlined domestic y foreign offshore del IRS.',
    bodyMd: STREAMLINED_ES,
    author: 'Taxalia',
    heroImage: '/assets/images/blog/streamlined-filing-compliance.webp',
    heroAlt: 'Formularios fiscales y calculadora dentro de una carpeta sobre mesa oscura',
    tags: ['Streamlined Filing', 'Offshore Compliance', 'FBAR'],
    draft: false,
    pubDate: '2026-02-14',
    updatedDate: '2026-02-14',
  },
];

/**
 * Synchronizes the default Taxalia blog posts.
 *
 * This intentionally runs even when the database already contains the old demo
 * posts, because the live site stores blog content in SQLite. Upserting the old
 * demo slugs as drafts hides the previous two articles, and upserting the new
 * posts publishes the four replacement articles in both English and Spanish.
 */
export function seedIfEmpty(repo: PostRepository): boolean {
  const wasEmpty = repo.count() === 0;

  for (const post of LEGACY_POSTS_TO_HIDE) {
    repo.upsert(post);
  }

  for (const post of SEED_POSTS) {
    repo.upsert(post);
  }

  return wasEmpty;
}
