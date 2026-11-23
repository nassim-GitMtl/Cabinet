# Guide utilisateur complet de Cabinet Dentaire Pro

Ce guide explique les fonctions actuellement disponibles dans Cabinet Dentaire Pro pour le personnel du cabinet et les patients. L’affichage et les actions visibles dépendent des autorisations attribuées à chaque membre. Les données d’un cabinet restent séparées de celles des autres cabinets.

Le logiciel fonctionne en français, en anglais et en arabe avec une mise en page de droite à gauche. Les montants sont enregistrés dans la devise du cabinet et les dates suivent son fuseau horaire.

Fonctions vérifiées dans la version du 20 novembre 2026.

## Sommaire

1. [Premiers pas](#premiers-pas)
2. [Profils et autorisations](#profils-et-autorisations)
3. [Tableau de bord](#tableau-de-bord)
4. [Agenda](#agenda)
5. [Réception](#réception)
6. [Patients](#patients)
7. [Dossier clinique](#dossier-clinique)
8. [Plans de traitement et devis](#plans-de-traitement-et-devis)
9. [Documents cliniques](#documents-cliniques)
10. [Facturation et paiements](#facturation-et-paiements)
11. [Caisse et dépenses](#caisse-et-dépenses)
12. [Honoraires des praticiens](#honoraires-des-praticiens)
13. [Catalogue des actes](#catalogue-des-actes)
14. [Inventaire et consommables](#inventaire-et-consommables)
15. [Stérilisation](#stérilisation)
16. [Relances patients](#relances-patients)
17. [Rapports et exports](#rapports-et-exports)
18. [Page publique et réservation en ligne](#page-publique-et-réservation-en-ligne)
19. [Portail patient](#portail-patient)
20. [Paramètres du cabinet](#paramètres-du-cabinet)
21. [Sécurité du compte](#sécurité-du-compte)
22. [Utilisation sur téléphone et hors connexion](#utilisation-sur-téléphone-et-hors-connexion)
23. [Parcours quotidiens recommandés](#parcours-quotidiens-recommandés)
24. [Fonctions prévues mais non disponibles](#fonctions-prévues-mais-non-disponibles)
25. [Résolution des problèmes courants](#résolution-des-problèmes-courants)

# Premiers pas

## Créer le premier cabinet

Lors d’une nouvelle installation, ouvrez **Créer un cabinet** depuis la page de connexion. Saisissez l’identité du cabinet et le compte du propriétaire. Sur un serveur local configuré en mode « première inscription uniquement », cette page se ferme dès que le premier cabinet existe ; les autres membres rejoignent ensuite le cabinet par invitation.

Après la première connexion, suivez la liste de configuration du tableau de bord : identité légale, coordonnées, tarifs réels, agenda, équipe, sécurité et page publique. Ne commencez pas la facturation réelle tant que les mentions légales et les tarifs n’ont pas été validés.

## Se connecter

1. Ouvrez l’adresse fournie par le cabinet.
2. Saisissez votre adresse courriel et votre mot de passe.
3. Si la vérification en deux étapes est activée, entrez le code de votre application d’authentification ou un code de récupération.
4. Si vous travaillez dans plusieurs cabinets, choisissez le cabinet actif.

Après plusieurs échecs, le compte ou l’adresse réseau peut être temporairement bloqué. Attendez la fin du délai indiqué avant de réessayer. Ne partagez jamais votre mot de passe ni vos codes de récupération.

## Naviguer dans le logiciel

Sur ordinateur, le menu principal se trouve à gauche. Sur téléphone, les fonctions principales sont dans la barre inférieure et les autres dans le menu **Plus**.

Les modules visibles peuvent inclure :

- Tableau de bord
- Agenda
- Réception
- Patients
- Relances
- Factures
- Rapports
- Caisse
- Dépenses
- Inventaire
- Stérilisation
- Catalogue
- Paramètres

Une fonction absente du menu signifie généralement que votre rôle ne possède pas l’autorisation nécessaire.

## Changer de langue ou de cabinet

Utilisez le sélecteur de langue dans le menu latéral ou l’en-tête mobile. Le choix français, anglais ou arabe s’applique à l’interface. Si votre compte appartient à plusieurs cabinets, utilisez **Changer de cabinet** avant de consulter ou de saisir des données.

## Consulter le guide de numérotation dentaire

Le bouton en forme de dent est toujours accessible dans le menu. Il affiche la numérotation FDI des dents permanentes :

- 11 à 18 : maxillaire supérieur droit
- 21 à 28 : maxillaire supérieur gauche
- 31 à 38 : mandibule inférieure gauche
- 41 à 48 : mandibule inférieure droite

# Profils et autorisations

Les rôles sont des modèles de départ. Le propriétaire peut créer des rôles personnalisés dans **Paramètres > Rôles**. Une personne ne voit que les données et actions autorisées.

| Profil courant | Fonctions principales |
| --- | --- |
| Propriétaire ou gérant | Toutes les fonctions du cabinet, équipe, rôles, sécurité, finances et paramètres |
| Chirurgien-dentiste | Dossiers cliniques, signature, actes, plans de traitement, agenda, facturation courante et validation de stérilisation |
| Hygiéniste | Dossiers cliniques, actes, notes signées, questionnaires et conversion des actes planifiés |
| Assistant dentaire | Patients, agenda, clinique, documents, relances et gestion de la stérilisation |
| Réceptionniste | Patients, agenda, accueil, demandes de réservation, devis, factures, paiements et caisse |
| Comptable | Lecture financière, dépenses, caisse, rapports financiers et exports |
| Stock et stérilisation | Inventaire, commandes, consommables et cycles de stérilisation |
| Administrateur technique | Comptes, paramètres et sécurité sans accès automatique aux données patients ou cliniques |

Les noms de rôles ne donnent pas les droits à eux seuls. Les autorisations réelles du rôle déterminent chaque action.

# Tableau de bord

Le tableau de bord présente uniquement des données réelles du cabinet :

- visites, actes et patients vus aujourd’hui ;
- activité clinique récente ;
- patients récemment ajoutés ;
- étapes de configuration du cabinet ;
- avertissement si des tarifs de démonstration doivent encore être remplacés.

Cliquez sur une carte ou une ligne pour ouvrir le module ou le dossier concerné. Le bouton **Nouveau patient** permet de commencer directement une inscription si votre rôle l’autorise.

# Agenda

## Afficher l’agenda

Ouvrez **Agenda**, puis choisissez :

- une date ;
- la vue jour ou semaine ;
- un praticien si plusieurs sont disponibles.

La vue jour regroupe les rendez-vous par praticien. La vue semaine couvre le dimanche au samedi. Les horaires, absences et fermetures configurés dans les paramètres servent de référence.

## Créer un rendez-vous

1. Cliquez sur **Nouveau rendez-vous** ou sur un créneau disponible.
2. Recherchez le patient par nom, numéro ou téléphone.
3. Choisissez le praticien, le type de rendez-vous, la date, l’heure, la durée et le fauteuil si nécessaire.
4. Enregistrez.

Le logiciel refuse les chevauchements pour le patient, le praticien ou le fauteuil. Un rendez-vous placé en dehors des heures de travail ou pendant une absence demande une confirmation explicite lorsque cette exception est permise.

## Gérer un rendez-vous

Ouvrez le rendez-vous pour :

- le confirmer ;
- le déplacer ;
- l’annuler avec un motif ;
- le marquer absent ;
- ouvrir le dossier patient ;
- démarrer les actions de consultation depuis la réception.

Un déplacement vérifie de nouveau la disponibilité et remet la confirmation à l’état approprié.

## Traiter les demandes en ligne

Ouvrez **Agenda > Demandes** pour voir les demandes reçues depuis un lien de réservation.

Pour une demande :

1. Vérifiez l’identité et les coordonnées.
2. Sélectionnez un patient existant ou créez une nouvelle fiche après contrôle des doublons.
3. Vérifiez que le créneau est toujours libre.
4. Approuvez pour créer le rendez-vous, ou refusez avec un motif compréhensible par le patient.

Une demande en ligne n’est jamais un rendez-vous confirmé avant l’approbation du cabinet.

## Créer un lien de réservation

Depuis la page des demandes, créez un lien public, copiez-le et transmettez-le au patient. Vous pouvez désactiver un lien qui ne doit plus servir. Les créneaux proposés respectent les horaires, absences, rendez-vous existants, délai minimal et horizon configurés.

# Réception

La réception affiche la file du jour et son état opérationnel. Le parcours avance dans un seul sens :

1. arrivé ;
2. en attente ;
3. en soins ;
4. terminé.

À chaque étape, utilisez l’action correspondante. Depuis un rendez-vous en soins ou terminé, les raccourcis permettent d’ajouter un acte ou de préparer la facturation. Une erreur de statut ne doit pas être corrigée en inventant un nouveau rendez-vous ; signalez-la à un responsable autorisé.

# Patients

## Rechercher un patient

Ouvrez **Patients** et utilisez la recherche par :

- nom français ou arabe ;
- numéro patient ;
- téléphone.

Les numéros de téléphone sont normalisés pour retrouver différentes écritures du même numéro. Les patients archivés restent traçables selon les filtres disponibles.

## Créer une fiche patient

1. Cliquez sur **Nouveau patient**.
2. Saisissez l’identité, les noms en arabe si nécessaires, le sexe, la date de naissance ou l’âge approximatif.
3. Ajoutez les coordonnées, l’adresse, la langue préférée et le contact d’urgence.
4. Renseignez la source d’acquisition et, pour une recommandation, le patient référent.
5. Vérifiez l’avertissement de doublon.
6. Confirmez la création seulement si la personne n’existe pas déjà.

La langue préférée sert notamment aux messages de relance et à certains documents destinés au patient.

## Importer une liste de patients

Ouvrez **Patients > Importer** pour charger un fichier CSV ou XLSX.

1. Téléchargez le modèle si nécessaire.
2. Choisissez le fichier.
3. Associez chaque colonne du fichier au champ correspondant.
4. Vérifiez l’aperçu, les erreurs et les doublons.
5. Confirmez l’importation.

Le fichier n’est pas conservé par le logiciel. Les mêmes contrôles sont exécutés de nouveau au moment de l’importation.

## Comprendre le dossier patient

L’en-tête reste visible avec l’identité, le numéro patient, l’âge, le praticien, les contacts et les alertes importantes. Les actions peuvent inclure **Ajouter un acte**, **Facturer**, **Modifier**, **Stérilisation** et **Archiver**.

Le dossier est organisé en onglets :

- **Aperçu** : prochain rendez-vous, plans de traitement actifs et solde ;
- **Détails** : coordonnées, identité, contact d’urgence et provenance ;
- **Santé** : questionnaire médical et validation clinique ;
- **Clinique** : historique, odontogramme et notes ;
- **Documents** : images et fichiers cliniques ;
- **Traitements** : plans et devis ;
- **Finances** : compte patient, factures, paiements et crédits disponibles.

## Modifier, archiver ou restaurer

Utilisez **Modifier** pour corriger les renseignements administratifs. Si une autre personne a modifié la fiche entre-temps, rechargez les données avant de recommencer.

L’archivage retire le patient des parcours courants sans supprimer son historique. Utilisez **Restaurer** pour le rendre actif. Le logiciel ne supprime pas les traces cliniques ou financières pour corriger une erreur.

## Gérer les alertes

Dans le panneau des alertes, ajoutez une information clinique avec son niveau : information, avertissement ou critique. Une réponse au questionnaire médical ne devient une alerte que lorsqu’un clinicien la promeut explicitement.

# Dossier clinique

## Questionnaire médical

Dans l’onglet **Santé** :

1. choisissez le mode de saisie par le personnel, le portail patient ou une tablette sécurisée ;
2. complétez les réponses sans transformer une absence de réponse en « non » ;
3. faites réviser la nouvelle version par un clinicien ;
4. marquez-la révisée ou sans changement ;
5. créez une alerte seulement si une réponse le justifie.

Un lien tablette est temporaire, utilisable une seule fois et limité au questionnaire du patient. Les modèles de questionnaire sont gérés dans **Paramètres > Questionnaire médical** et doivent être approuvés avant utilisation.

## Ajouter un acte réalisé

Depuis le dossier patient, cliquez sur **Ajouter un acte**.

1. Choisissez la date et le praticien.
2. Recherchez l’acte dans le catalogue ou utilisez les favoris et récents.
3. Indiquez la quantité.
4. Sélectionnez la dent et les faces si l’acte l’exige.
5. Vérifiez le prix proposé.
6. Si vous modifiez un prix contrôlé, saisissez le motif et l’approbateur demandé.
7. Enregistrez l’acte réalisé.

Le nom, le code et le prix sont copiés dans l’historique au moment de l’enregistrement. Une modification future du catalogue ne change donc pas les soins déjà enregistrés.

## Corriger un acte

Un acte réalisé n’est pas effacé. Utilisez la fonction d’annulation ou de correction avec un motif, puis saisissez le bon acte si nécessaire. Cette méthode conserve la traçabilité clinique, financière et de stock.

## Utiliser l’odontogramme

Dans l’onglet **Clinique** :

1. sélectionnez une dent permanente selon la numérotation FDI ;
2. choisissez le constat et, si nécessaire, les faces ;
3. ajoutez le constat ;
4. résolvez-le ou corrigez-le par un nouvel événement lorsque la situation change.

Les constats sont conservés avec leur historique. Les actes liés peuvent apparaître avec la dent et la date correspondantes.

## Rédiger et signer une note clinique

1. Créez une note brouillon, éventuellement à partir d’un modèle.
2. Saisissez le contenu clinique et les références utiles.
3. Révisez le brouillon.
4. Signez lorsque le contenu est définitif.

Une note signée est immuable. Pour ajouter ou corriger une information, créez un amendement lié à la note. La chaîne d’intégrité permet de détecter une modification anormale.

# Plans de traitement et devis

## Créer un plan

Dans l’onglet **Traitements**, cliquez sur **Nouveau plan**.

1. Donnez un titre clair.
2. Ajoutez les actes proposés depuis le catalogue.
3. Renseignez quantité, dent, faces et prix autorisé.
4. Vérifiez le total.
5. Enregistrez la version.

Chaque version conserve ses propres actes et tarifs. Une révision ne remplace pas l’ancienne version.

## Proposer et enregistrer la décision

Proposez la version au patient, puis enregistrez son acceptation ou son refus sur cette version exacte. Si le plan change après la décision, créez une révision et demandez une nouvelle décision.

## Imprimer un devis

Ouvrez le plan puis **Imprimer le devis**. Choisissez :

- français ;
- arabe avec mise en page droite à gauche ;
- bilingue français et arabe.

Utilisez la fonction d’impression du navigateur pour imprimer ou enregistrer le document en PDF.

## Convertir les actes acceptés

Lorsqu’un soin accepté est réalisé, utilisez l’action de conversion pour créer l’acte clinique correspondant. Un même élément accepté ne peut être converti qu’une fois.

## Créer un échéancier

Pour un devis accepté, créez les échéances dont la somme correspond au total. Chaque encaissement d’échéance devient un acompte dans le compte patient. Un échéancier déjà encaissé ne se remplace pas librement ; créez une nouvelle version seulement selon les règles affichées.

# Documents cliniques

## Ajouter une image ou un document

Dans l’onglet **Documents** :

1. choisissez un fichier ou utilisez la caméra du téléphone ;
2. sélectionnez le type et ajoutez un libellé utile ;
3. envoyez le fichier ;
4. vérifiez qu’il apparaît dans le dossier.

Les formats reconnus incluent les images JPEG, PNG et WebP, ainsi que PDF et DICOM. Le serveur vérifie le contenu réel du fichier et conserve une empreinte d’intégrité. La taille maximale est de 20 Mo.

## Consulter et comparer

Ouvrez un fichier pour le consulter. Chaque consultation est contrôlée et journalisée. Pour un suivi visuel, créez une paire avant et après à partir de deux images du même patient.

Les fichiers restent privés sur le serveur du cabinet et sont inclus dans les sauvegardes. Il n’existe actuellement ni annotation ni mesure intégrée, et le logiciel n’offre pas encore de visualiseur DICOM spécialisé.

# Facturation et paiements

## Créer et émettre une facture

Depuis le dossier patient, cliquez sur **Facturer**.

1. Sélectionnez les actes réalisés non encore facturés.
2. Vérifiez les lignes, quantités, dates et montants.
3. Créez le brouillon.
4. Contrôlez les coordonnées de l’émetteur et du patient.
5. Émettez la facture.

Une facture émise reçoit un numéro annuel et devient immuable. Une erreur se corrige par annulation autorisée, avoir ou nouveau document selon le cas, jamais par modification silencieuse.

## Consulter les factures

Ouvrez **Factures** pour rechercher et filtrer les documents. Une facture peut être en brouillon, émise, partiellement payée, payée ou annulée. Ouvrez-la pour voir ses lignes, son solde, les paiements appliqués et les actions disponibles.

## Enregistrer un paiement

Depuis la facture ou le compte patient :

1. saisissez le montant et la date ;
2. choisissez le mode de paiement ;
3. ajoutez une référence si utile ;
4. confirmez l’encaissement ;
5. imprimez le reçu si demandé.

Le paiement est appliqué aux factures selon l’action choisie. Un paiement supérieur au montant dû ou un acompte reste en crédit non affecté dans le compte patient.

## Utiliser un acompte

Enregistrez un acompte avant facturation ou depuis un échéancier. Lorsqu’une facture est créée, appliquez le crédit disponible sans créer un second reçu. Le solde du compte distingue les sommes dues et le crédit non affecté.

## Corriger un paiement

Selon votre autorisation, vous pouvez :

- annuler un paiement saisi par erreur, ce qui rouvre les soldes ;
- rembourser seulement la partie encore disponible ;
- émettre un avoir sans dépasser la partie admissible de la facture.

Chaque correction garde l’historique du document d’origine.

## Imprimer les documents financiers

Les factures, reçus, devis et relevés de compte peuvent être imprimés en français, en arabe ou en version bilingue. Le choix de langue dans l’écran d’impression ne modifie pas les données financières.

Pour un relevé patient, ouvrez l’onglet **Finances**, puis **Imprimer le relevé**. Le relevé récapitule les factures, paiements, avoirs, remboursements et le solde de clôture.

# Caisse et dépenses

## Ouvrir et clôturer la caisse

Ouvrez **Caisse** pour la journée concernée.

1. Saisissez le fond d’ouverture.
2. Le logiciel calcule l’espèce théorique à partir des encaissements, remboursements, dépenses et mouvements en espèces.
3. Comptez l’espèce réelle.
4. Saisissez un motif si un écart existe.
5. Clôturez puis faites approuver si le rôle du cabinet l’exige.

Les paiements par carte ou virement ne sont pas ajoutés à l’espèce attendue. Après la clôture, les nouvelles écritures d’espèces sur cette date sont bloquées.

Pendant une session ouverte, utilisez **Entrée** ou **Sortie de caisse** pour un mouvement d’espèces qui n’est ni un paiement patient ni une dépense. Indiquez toujours son motif. Une session clôturée peut être imprimée et reste visible dans l’historique des derniers jours.

## Enregistrer une dépense

Ouvrez **Dépenses** pour :

- choisir une catégorie prédéfinie ;
- saisir le fournisseur, créé automatiquement s’il est nouveau ;
- créer une dépense avec date, montant, mode et note ;
- la marquer payée ;
- l’annuler selon les règles affichées.

Une dépense en espèces entre dans le calcul de caisse. Les pièces jointes, dépenses récurrentes et soldes fournisseurs ne sont pas encore disponibles.

# Honoraires des praticiens

Pour les cabinets où plusieurs praticiens travaillent au pourcentage. Seul le propriétaire configure et voit les honoraires de tous ; chaque praticien voit uniquement les siens (menu **Honoraires**).

## Tarifs et honoraires de chaque praticien

Dans **Honoraires > Configuration**, indiquez le pourcentage par défaut de chaque praticien, puis ouvrez **Tarifs et honoraires** : pour chaque prestation du catalogue, saisissez le tarif propre à ce praticien et ses honoraires (en % du tarif ou en montant fixe). Une case vide garde le tarif du catalogue ou son pourcentage par défaut. La colonne « Gagne par acte » montre le résultat avant d’enregistrer chaque ligne.

Quand un praticien enregistre un acte, son tarif s’applique automatiquement et il ne peut pas le modifier : seul le propriétaire change les prix.

## Ce qui est calculé

À l’émission de la facture, la part du praticien est figée pour chaque ligne (une modification ultérieure des règles ne change pas le passé). Pour les prothèses, cochez dans le catalogue « Déduire les frais de laboratoire » : les frais de labo saisis à la facturation sont alors retirés avant le calcul. La part « encaissée » suit ce que le patient a réellement payé, après avoirs éventuels.

## Verser, corriger, clôturer

**Enregistrer un versement** indique la somme remise au praticien ; en espèces, elle sort de la caisse du jour. Un versement erroné s’annule (il reste visible, barré). **Corriger** ajoute une ligne de correction sur un acte. **Clôturer un mois** le rend définitif : ce qui arrive ensuite compte dans le mois en cours. **Anciennes factures** permet d’attribuer, une par une, les lignes facturées avant l’activation des honoraires.

# Catalogue des actes

Le catalogue contient les actes proposés dans les soins, devis et factures.

Pour chaque acte, vous pouvez selon vos droits :

- rechercher par code, nom ou catégorie ;
- voir les noms français, anglais et arabe ;
- modifier le tarif par défaut ;
- consulter l’historique des prix ;
- indiquer si une dent ou des faces sont requises ;
- gérer les favoris et retrouver les actes récemment utilisés.

Remplacez les prix de démonstration avant l’utilisation réelle. Un nouveau tarif ne modifie jamais les actes, devis ou factures déjà enregistrés.

# Inventaire et consommables

## Lire le tableau de stock

Ouvrez **Inventaire** pour voir :

- le nombre d’articles ;
- les stocks sous le minimum ;
- les lots proches de leur expiration ;
- les lots expirés ;
- le détail par article, lot et établissement.

Le stock est calculé à partir des mouvements. Il n’est pas remplacé manuellement par un total.

## Créer un article et recevoir un lot

1. Créez l’article avec son code interne, nom, catégorie, unité et seuil minimal.
2. Enregistrez une réception avec l’établissement, le numéro de lot, la date de réception, la date d’expiration et la quantité.
3. Vérifiez que le lot apparaît dans le tableau.

## Consommer ou ajuster le stock

Enregistrez une sortie pour l’usage courant. La sélection automatique utilise d’abord les lots qui expirent le plus tôt, sans utiliser un lot expiré. Une sortie ne peut pas rendre un lot négatif.

Pour une correction, créez un mouvement d’ajustement avec le motif exact. Ne tentez pas de modifier un mouvement ancien.

## Scanner un code

Utilisez le scanner pour lire un EAN, GTIN, Code 128, QR code ou Data Matrix, ou saisissez le code avec un lecteur USB. Lorsque le navigateur prend en charge la caméra, l’image reste traitée localement. Les codes GS1 peuvent remplir le produit, le lot et la date d’expiration.

Un code erroné est désactivé, puis le bon code est ajouté. Il n’est pas réattribué à un autre produit.

## Gérer les commandes fournisseurs

1. Créez une commande avec le fournisseur, l’établissement, la date et les articles.
2. Enregistrez les quantités reçues sur chaque ligne.
3. Pour chaque réception, confirmez le lot et l’expiration.
4. La commande passe de commandée à partiellement reçue, puis reçue.

Le logiciel empêche de recevoir plus que la quantité commandée.

## Configurer les consommables par acte

Ouvrez **Inventaire > Consommables**. Associez à chaque acte du catalogue les articles et quantités normalement utilisés.

Deux modes sont possibles :

- **Suggestion** : le soin crée une consommation en attente qu’un membre confirme ou ignore avec un motif ;
- **Automatique** : le soin consomme immédiatement les lots disponibles selon la règle du premier lot expirant.

Un manque de stock ne bloque jamais l’enregistrement du soin. La consommation reste en attente pour traitement.

## Tracer un lot et gérer un rappel

Cliquez sur un numéro de lot pour voir ses mouvements, les actes et patients associés, ainsi que les usages manuels non rattachés à un patient. Utilisez l’export de traçabilité pour préparer un rappel. L’accès aux identités patient exige l’autorisation correspondante.

Les suggestions de réapprovisionnement sont expliquées par l’usage récent, le seuil minimal, le stock utilisable, les commandes ouvertes et l’activité future de l’agenda. Elles restent des suggestions à vérifier par le personnel.

# Stérilisation

## Configurer le matériel

Ouvrez **Stérilisation** pour ajouter :

- les stérilisateurs ;
- les ensembles d’instruments ;
- leur établissement de rattachement.

Un équipement incorrect est désactivé au lieu d’être supprimé.

## Enregistrer un cycle

1. Choisissez le stérilisateur, le programme, la date et l’heure.
2. Saisissez les paramètres physiques et les résultats des indicateurs.
3. Ajoutez les ensembles présents dans la charge.
4. Enregistrez le cycle.

Le cycle commence **En attente de libération**. L’enregistrement ne certifie pas automatiquement la charge.

## Libérer, refuser ou rappeler

Une personne possédant l’autorisation de libération examine le cycle :

- **Libérer** si les contrôles sont conformes ;
- **Échouer** si un indicateur est non conforme ;
- **Rappeler** une charge précédemment libérée lorsqu’un résultat ultérieur l’exige.

Un indicateur biologique en attente peut être complété une seule fois. Un résultat négatif sur une charge libérée déclenche son rappel.

## Créer et utiliser les sachets

Depuis le cycle libéré, créez les sachets et imprimez leurs étiquettes Code 128. Un sachet ne peut être associé à un patient que s’il est libéré, non expiré et non jeté.

Depuis le dossier patient, utilisez **Stérilisation** pour associer un sachet au patient et, si nécessaire, à l’acte exact. Une association incorrecte est annulée avec un motif, sans effacer la trace.

# Relances patients

Ouvrez **Relances** pour préparer les contacts suivants :

- rappel de rendez-vous ;
- conseils après une visite ;
- demande d’avis ;
- remerciement après une recommandation ;
- rappel périodique ;
- traitement inachevé ;
- devis en attente ;
- absence à un rendez-vous.

## Préparer et envoyer un message

1. Ouvrez la carte de relance.
2. Vérifiez le motif, la date source et le numéro du patient.
3. Relisez le message dans la langue préférée du patient.
4. Ouvrez WhatsApp, SMS ou l’appel téléphonique.
5. Envoyez le message depuis votre appareil.
6. Enregistrez le résultat du contact : préparé, reporté, refusé ou autre état proposé.

Le logiciel prépare le message mais ne peut pas confirmer que WhatsApp ou le téléphone l’a réellement envoyé. Les messages n’incluent pas automatiquement de diagnostic, d’acte ou de numéro de dent.

## Personnaliser les modèles

Dans **Paramètres > Relances**, modifiez les modèles français, anglais et arabe, les conseils après soin et l’adresse de demande d’avis. Vérifiez les variables affichées avant d’enregistrer.

# Rapports et exports

## Rapport d’activité

Ouvrez **Rapports**, puis choisissez le jour ou le mois. Le rapport distingue notamment :

- production selon la date des soins ;
- ventes facturées selon la date des documents ;
- encaissements bruts ;
- encaissements nets après remboursements ;
- actes non facturés ;
- factures, avoirs et paiements ;
- ventilation par acte, praticien et jour.

Les devises différentes sont affichées séparément et ne sont jamais additionnées ensemble.

## Exporter

Avec l’autorisation d’export, téléchargez :

- CSV compatible avec Excel en français ;
- Excel XLSX avec feuilles structurées.

Les exports sont journalisés. Les cellules provenant du texte utilisateur sont protégées contre l’exécution de formules.

## Suivre les créances

Ouvrez **Rapports > Ancienneté des créances** et choisissez une date. Les soldes sont répartis selon l’âge depuis l’échéance : 0 à 30 jours, 31 à 60 jours, 61 à 90 jours et plus de 90 jours. Vous pouvez exporter la liste ou ouvrir le dossier patient.

## Analyser l’acquisition

Ouvrez **Rapports > Acquisition** pour comparer les sources de nouveaux patients, leur part traitée, la production associée, le parcours des demandes de réservation et les recommandations de patients. Les montants ne sont visibles qu’avec l’autorisation financière.

# Page publique et réservation en ligne

## Publier la page du cabinet

Dans **Paramètres > Page publique** :

1. choisissez une adresse courte disponible ;
2. ajoutez la présentation en français, anglais et arabe ;
3. ajoutez le numéro WhatsApp, la carte, les réseaux sociaux et le lien d’avis ;
4. associez un lien de réservation actif ;
5. choisissez les actes à mettre en avant et décidez si leurs prix sont visibles ;
6. publiez la page.

L’adresse, le téléphone et les horaires affichés proviennent de l’identité du cabinet et des horaires configurés dans l’agenda. Corrigez ces informations dans leurs écrans respectifs avant de publier.

La page publique ne montre aucune donnée patient ni liste interne du personnel. Prévisualisez-la avant de partager son adresse.

## Imprimer l’affiche avec code QR

Utilisez **Imprimer l’affiche** pour produire une affiche contenant le code QR de la page publique ou de réservation. Imprimez-la avec le navigateur. Vérifiez que l’adresse est accessible depuis le téléphone du patient, notamment hors du réseau du cabinet.

## Parcours du patient sans compte

Le patient ouvre le lien, choisit un type de rendez-vous et un créneau réel, puis renseigne ses coordonnées. Il reçoit une référence secrète pour consulter l’état de sa demande. Le cabinet doit ensuite approuver ou refuser cette demande.

La page publique, la réservation et le portail ne sont accessibles depuis Internet que si le serveur du cabinet a été exposé de manière sécurisée avec un domaine et HTTPS.

# Portail patient

## Créer l’accès d’un patient

Dans le dossier patient, le personnel autorisé :

1. vérifie l’identité de la personne en présence ;
2. lie son adresse courriel à la fiche exacte ;
3. crée un lien d’activation valable sept jours ;
4. transmet ce lien par un canal sûr.

Le patient choisit son mot de passe sur la page d’activation. Son compte est distinct des comptes du personnel.

## Fonctions disponibles pour le patient

Après connexion, le patient peut :

- consulter ses prochains rendez-vous ;
- voir ses devis acceptés et leurs échéances ;
- consulter ses factures, soldes et paiements ;
- compléter le questionnaire médical de chaque cabinet lié ;
- accepter ou refuser une demande de partage ;
- voir les autorisations de partage actives ;
- révoquer une autorisation active.

Le portail n’accepte pas encore de paiement en ligne et n’affiche pas l’ensemble du dossier clinique.

## Parcours de soins

Dans le dossier patient, onglet **Parcours patient**, le praticien partage avec le patient des étapes de son traitement, des photos ou des paires avant/après, chacune avec une explication simple. L’avancement du plan de traitement accepté s’affiche automatiquement.

Rien n’apparaît dans l’espace du patient tant qu’il n’a pas lui-même choisi **Afficher mon parcours** ; il peut le masquer à tout moment. L’onglet indique s’il l’a activé. Un élément partagé par erreur se **retire** (avec une raison) : il disparaît de l’espace patient mais reste tracé dans le dossier.

## Consentement au partage entre cabinets

Le cabinet demande un accès en précisant le but, les catégories de données, la période et l’inclusion éventuelle des futures mises à jour. Seul le patient peut approuver ou refuser. Il peut ensuite révoquer l’accès. Chaque consultation partagée est contrôlée et journalisée ; le personnel ne dispose pas d’un contournement d’urgence du consentement.

## Récupérer un accès patient

Après vérification de l’identité, le cabinet peut créer un lien de récupération unique valable 24 heures. Le nouveau mot de passe ferme les anciennes sessions. N’envoyez jamais ce lien avant d’avoir vérifié la personne.

# Paramètres du cabinet

## Identité et documents

Dans **Paramètres > Identité du cabinet**, configurez :

- raison sociale et nom du cabinet ;
- NIF, NIS, registre de commerce et article d’imposition ;
- adresse, téléphone et courriel ;
- logo ;
- devise et affichage selon les options disponibles.

Lorsqu’une facture ou un reçu est émis, l’identité utilisée est figée dans le document. Une modification ultérieure n’altère pas les anciens documents.

## Agenda

Dans **Paramètres > Agenda**, gérez :

- fauteuils ;
- types de rendez-vous et noms dans les trois langues ;
- durée par défaut ;
- disponibilité à la réservation en ligne ;
- horaires hebdomadaires par praticien ;
- absences individuelles ou fermeture du cabinet.

Vous pouvez définir jusqu’à deux plages par jour. Les plages ne doivent pas se chevaucher.

## Équipe

Dans **Paramètres > Équipe** :

- invitez un membre avec son rôle exact ;
- identifiez les praticiens qui apparaissent dans l’agenda ;
- modifiez le rôle ;
- désactivez un accès ;
- créez un lien de réinitialisation de mot de passe pour un collègue admissible.

Une invitation est à usage unique et expire après sept jours. Le propriétaire et la personne connectée sont protégés contre certaines actions qui pourraient verrouiller le cabinet.

## Rôles

Dans **Paramètres > Rôles**, créez un rôle personnalisé ou modifiez ses autorisations. Accordez uniquement les fonctions nécessaires. Le rôle propriétaire est protégé.

## Questionnaire médical

Créez une version complète du questionnaire, vérifiez les formulations puis faites-la approuver par une personne autorisée. Une version approuvée reste liée aux réponses historiques et ne se modifie pas. Pour changer les questions, créez une nouvelle version.

## Relances et page publique

Les écrans correspondants permettent de personnaliser les modèles de messages, les conseils après soins, le lien d’avis, la présentation publique, les horaires et l’adresse partagée.

## Journal d’activité

**Paramètres > Journal d’activité** montre qui a fait quoi et quand : création de patient, facture émise, paiement, prix modifié, etc., avec le nom de la personne. Filtrez par dates, personne ou domaine ; le bouton **Historique** du dossier patient ouvre le journal de ce seul patient. L’onglet « Toutes les modifications » liste chaque changement enregistré dans la base (personne et champs modifiés, jamais leur contenu). Rien dans ce journal ne peut être modifié ni supprimé. Réservé au propriétaire et à l’administrateur technique ; les honoraires n’y apparaissent que pour le propriétaire.

# Sécurité du compte

## Activer la vérification en deux étapes

Dans **Paramètres > Sécurité** :

1. démarrez l’activation ;
2. scannez le code avec une application d’authentification ;
3. saisissez le code de vérification ;
4. conservez les huit codes de récupération dans un endroit sûr.

Chaque code de récupération ne fonctionne qu’une fois.

## Gérer les sessions

Consultez les sessions actives et révoquez celles que vous ne reconnaissez pas. Une modification de mot de passe peut fermer les autres sessions.

## Changer son mot de passe

Dans **Paramètres > Sécurité**, saisissez le mot de passe actuel, puis le nouveau mot de passe deux fois. Les autres appareils sont déconnectés.

## Mot de passe oublié

Utilisez **Mot de passe oublié** sur la page de connexion. Selon la configuration :

- le courriel de récupération est envoyé sans révéler si l’adresse existe ;
- un propriétaire ou administrateur crée un lien depuis l’équipe ;
- le propriétaire demande à la personne qui administre le serveur d’exécuter la procédure de récupération.

Les liens sont temporaires et à usage unique. Pour un téléphone perdu, l’administrateur peut aussi désactiver la vérification en deux étapes lors d’une réinitialisation autorisée.

# Utilisation sur téléphone et hors connexion

L’interface s’adapte aux téléphones, tablettes et ordinateurs. La caméra peut être utilisée pour les documents cliniques et, selon le navigateur, les codes de stock.

Le serveur du cabinet peut fonctionner sans Internet sur le réseau local. En revanche :

- le téléphone ou l’ordinateur doit toujours joindre le serveur ;
- aucune donnée patient n’est enregistrée hors connexion sur l’appareil ;
- aucune saisie hors connexion n’est mise en attente ;
- si la bannière de déconnexion apparaît, arrêtez la saisie et réessayez après le retour du serveur ;
- les liens WhatsApp et les fonctions publiques extérieures peuvent nécessiter Internet.

# Parcours quotidiens recommandés

## Ouverture du cabinet

1. Vérifiez la connexion au serveur.
2. Consultez le tableau de bord et l’agenda.
3. Ouvrez la caisse avec le fond réel.
4. Vérifiez les demandes de réservation et les relances du jour.
5. Traitez les alertes urgentes de stock ou de stérilisation.

## Accueil d’un patient

1. Recherchez le patient avant de créer une fiche.
2. Vérifiez son identité et ses coordonnées.
3. Mettez à jour le questionnaire médical si nécessaire.
4. Faites avancer le statut dans la réception.
5. Signalez au praticien les alertes visibles.

## Consultation clinique

1. Ouvrez le dossier depuis l’agenda ou la réception.
2. Lisez les alertes et le questionnaire révisé.
3. Consultez le plan, l’odontogramme et les documents utiles.
4. Enregistrez les actes réellement réalisés.
5. Complétez et signez la note.
6. Confirmez les consommables en attente et le sachet stérile si nécessaire.
7. Préparez le message après soins.

## Sortie et encaissement

1. Vérifiez les actes réalisés.
2. Créez puis contrôlez la facture.
3. Émettez-la seulement lorsqu’elle est correcte.
4. Enregistrez le paiement ou l’acompte.
5. Remettez le reçu et, si nécessaire, le prochain rendez-vous.
6. Vérifiez les échéances ou le solde restant.

## Fermeture du cabinet

1. Vérifiez les patients encore dans la file.
2. Contrôlez les actes non facturés et les consommations en attente.
3. Comptez puis clôturez la caisse.
4. Vérifiez que la sauvegarde quotidienne est planifiée et que l’espace disque est suffisant.

# Fonctions prévues mais non disponibles

Les fonctions suivantes ne doivent pas être promises comme disponibles :

- accès complet au serveur du cabinet depuis Internet sans configuration réseau supplémentaire ;
- paiement en ligne dans le portail ;
- envoi automatique confirmé par SMS ou WhatsApp Business ;
- signature électronique du consentement de traitement ;
- dossier parodontal graphique et odontogramme des dents temporaires ;
- annotations, mesures et visualiseur DICOM spécialisé ;
- accès familial ou tuteur dans le portail ;
- campagnes marketing avec consentement ;
- gestion des travaux de laboratoire ;
- pièces jointes et récurrence pour les dépenses ;
- facturation à un tiers et facturation familiale ;
- gestion complète de plusieurs établissements ou entités juridiques dans l’interface ;
- intégrations FHIR ou synchronisation avec des services externes.

# Résolution des problèmes courants

## Une fonction ou un bouton est absent

Vérifiez le rôle du compte dans **Paramètres > Équipe** et les autorisations dans **Paramètres > Rôles**. Une fonction peut aussi être cachée parce que le patient est archivé, qu’un document est déjà émis ou qu’une étape précédente n’est pas terminée.

## Une action est refusée

Lisez le message affiché. Les causes habituelles sont : conflit de rendez-vous, document immuable, caisse déjà clôturée, lot insuffisant ou expiré, demande de réservation déjà traitée, absence d’autorisation, ou fiche modifiée par une autre personne.

## Le logiciel indique qu’il est hors connexion

N’enregistrez pas de nouvelles données. Vérifiez le Wi-Fi ou le câble réseau, puis confirmez que le serveur du cabinet est allumé. Rechargez la page seulement après le retour de la connexion.

## Un document imprimé n’a pas la bonne langue

Revenez à l’écran d’impression et choisissez explicitement **Français**, **Arabe** ou **Bilingue**. Vérifiez aussi la langue préférée du patient.

## Un patient semble exister en double

Recherchez avec le numéro de téléphone, les variantes du nom et les patients archivés. Ne créez pas une nouvelle fiche avant vérification. La fusion de deux fiches n’est pas encore disponible dans l’interface.

## Un montant paraît incorrect

Ouvrez le compte patient et vérifiez séparément les factures, avoirs, paiements, remboursements et crédits non affectés. N’ajoutez pas une écriture compensatrice sans identifier l’origine. Demandez à une personne autorisée de corriger le document selon le parcours prévu.

## Une sauvegarde ou une restauration est nécessaire

La personne qui administre le serveur doit suivre [le guide d’installation du cabinet](./INSTALLATION-CABINET.md). Une restauration remplace les données actives et doit être préparée avec une sauvegarde de sécurité.
