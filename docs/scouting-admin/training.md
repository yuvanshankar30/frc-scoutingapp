# Scouting Admin: Training

Training turns training mode on for a competition code (`scouting_events.training`), finds finished events and their
matches on The Blue Alliance (search or a random pick), and adds a past match as the next qualification number under
the training code, stored in `scouting_training_matches` with its teams and video. Scouts are assigned to its robots as
ordinary data-scout assignments, so My Reports, the scouting form and completion tracking work unchanged; the form
shows the past match and its video. API: `/api/scouting-training`; helpers: `src/lib/scouting/training.js`. Both need
migration `20261013000000_scouting_tabs_and_training.sql`.
