"""Editing one step of a finished workflow invocation and rerunning it with the job cache."""

import copy
import json

import pytest

from galaxy_test.base.populators import skip_without_tool
from .test_workflows import BaseWorkflowsApiTestCase

STEP_RERUN_RANDOM_LINES_PARAMETERS = {
    "num_lines": "4",
    "seed_source|seed_source_selector": "set_seed",
    "seed_source|seed": "asdf",
}


class TestStepRerunApi(BaseWorkflowsApiTestCase):
    def _step_rerun_order_indices(self, workflow_id: str) -> dict[str, str]:
        # Galaxy orders steps topologically on import, so resolve order indices by label.
        workflow = self.workflow_populator.download_workflow(workflow_id)
        return {step["label"]: str(index) for index, step in workflow["steps"].items()}

    def _step_rerun_invoke(self, workflow_id: str, history_id: str, inputs: dict, parameters: dict) -> str:
        request = {
            "history": f"hist_id={history_id}",
            "inputs": json.dumps(inputs),
            "inputs_by": "name",
            "parameters_normalized": True,
            "parameters": json.dumps(parameters),
        }
        return self.workflow_populator.invoke_workflow_and_wait(workflow_id, request=request).json()["id"]

    def _step_rerun_from_request(
        self, invocation_id: str, workflow_id: str, edited_step: str, updates: dict, **request_updates
    ) -> str:
        # Export the invocation's request, change one step's bag, re-invoke with the job cache on.
        request = self.workflow_populator.invocation_to_request(invocation_id)
        request["parameters"][edited_step].update(updates)
        request["use_cached_job"] = True
        request.update(request_updates)
        return self.workflow_populator.invoke_workflow_and_wait(workflow_id, request=request).json()["id"]

    def _step_rerun_jobs(self, invocation_id: str) -> dict[str, list[dict]]:
        invocation = self.workflow_populator.get_invocation(invocation_id, step_details=True)
        by_label = {}
        for step in invocation["steps"]:
            if step["jobs"]:
                jobs = [self.dataset_populator.get_job_details(job["id"], full=True).json() for job in step["jobs"]]
                for job in jobs:
                    assert job["state"] == "ok", job
                by_label[step["workflow_step_label"]] = jobs
        return by_label

    def _step_rerun_single_jobs(self, invocation_id: str) -> dict[str, dict]:
        by_label = self._step_rerun_jobs(invocation_id)
        for label, jobs in by_label.items():
            assert len(jobs) == 1, (label, jobs)
        return {label: jobs[0] for label, jobs in by_label.items()}

    def _assert_step_rerun_reuse(
        self, first_jobs: dict[str, dict], rerun_jobs: dict[str, dict], reused: set[str], recomputed: set[str]
    ):
        assert set(first_jobs) == set(rerun_jobs) == reused | recomputed
        for job in first_jobs.values():
            assert not job["copied_from_job_id"], job
        for label in reused:
            assert rerun_jobs[label]["copied_from_job_id"] == first_jobs[label]["id"], rerun_jobs[label]
        for label in recomputed:
            assert not rerun_jobs[label]["copied_from_job_id"], rerun_jobs[label]

    def _step_rerun_chain_setup(self, history_id: str) -> tuple[str, str, str]:
        # the_input -> first_cat -> second_cat -> random_lines -> downstream_cat, with sibling_lines
        # hanging off first_cat; the first invocation sets random_lines to num_lines=4 at run time.
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  the_input: data
steps:
  first_cat:
    tool_id: cat1
    in:
      input1: the_input
  second_cat:
    tool_id: cat1
    in:
      input1: first_cat/out_file1
  random_lines:
    tool_id: random_lines1
    state:
      num_lines: 3
      seed_source:
        seed_source_selector: set_seed
        seed: asdf
    in:
      input: second_cat/out_file1
  sibling_lines:
    tool_id: random_lines1
    state:
      num_lines: 2
      seed_source:
        seed_source_selector: set_seed
        seed: asdf
    in:
      input: first_cat/out_file1
  downstream_cat:
    tool_id: cat1
    in:
      input1: random_lines/out_file1
""")
        edited_step = self._step_rerun_order_indices(workflow_id)["random_lines"]
        hda = self.dataset_populator.new_dataset(history_id, content="1\n2\n3\n4\n5\n6\n", wait=True)
        first_invocation_id = self._step_rerun_invoke(
            workflow_id,
            history_id,
            {"the_input": {"src": "hda", "id": hda["id"]}},
            {edited_step: dict(STEP_RERUN_RANDOM_LINES_PARAMETERS)},
        )
        return workflow_id, edited_step, first_invocation_id

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_from_request_reuses_unchanged_jobs(self, history_id: str):
        # Edit one step's parameters on an exported invocation request and re-invoke with the
        # job cache on: steps upstream of (and beside) the edited step reuse their jobs, the
        # edited step and everything downstream of it get new jobs.
        workflow_id, edited_step, first_invocation_id = self._step_rerun_chain_setup(history_id)

        request = self.workflow_populator.invocation_to_request(first_invocation_id)
        assert request["parameters"] == {edited_step: STEP_RERUN_RANDOM_LINES_PARAMETERS}
        assert request["parameters_normalized"] is True
        assert request["instance"] is True

        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"num_lines": "2"}
        )

        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        second_jobs = self._step_rerun_single_jobs(second_invocation_id)
        self._assert_step_rerun_reuse(
            first_jobs,
            second_jobs,
            reused={"first_cat", "second_cat", "sibling_lines"},
            recomputed={"random_lines", "downstream_cat"},
        )
        assert json.loads(first_jobs["random_lines"]["params"]["num_lines"]) == "4"
        assert json.loads(second_jobs["random_lines"]["params"]["num_lines"]) == "2"

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_prefers_jobs_from_source_invocation(self, history_id: str):
        # A rerun that names its source invocation should reuse that invocation's jobs even when
        # newer equivalent jobs exist (e.g. the same workflow run again without the cache). The
        # newest-first cache would otherwise pick a job whose outputs are different dataset rows,
        # so nothing downstream would match the source invocation's jobs.
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  the_input: data
steps:
  a:
    tool_id: cat1
    in:
      input1: the_input
  b:
    tool_id: cat1
    in:
      input1: a/out_file1
  c:
    tool_id: random_lines1
    state:
      num_lines: 3
      seed_source:
        seed_source_selector: set_seed
        seed: asdf
    in:
      input: b/out_file1
  d:
    tool_id: random_lines1
    state:
      num_lines: 2
      seed_source:
        seed_source_selector: set_seed
        seed: asdf
    in:
      input: c/out_file1
""")
        workflow = self.workflow_populator.download_workflow(workflow_id)
        order_index_by_label = {step["label"]: int(index) for index, step in workflow["steps"].items()}
        c_index = str(order_index_by_label["c"])
        d_index = str(order_index_by_label["d"])

        hda = self.dataset_populator.new_dataset(history_id, content="1\n2\n3\n4\n5\n6\n", wait=True)
        first_request = {
            "history": f"hist_id={history_id}",
            "inputs": json.dumps({"the_input": {"src": "hda", "id": hda["id"]}}),
            "inputs_by": "name",
            "parameters_normalized": True,
            "parameters": json.dumps(
                {
                    c_index: {
                        "num_lines": "4",
                        "seed_source|seed_source_selector": "set_seed",
                        "seed_source|seed": "asdf",
                    }
                }
            ),
        }

        def invoke(request: dict) -> str:
            return self.workflow_populator.invoke_workflow_and_wait(workflow_id, request=request).json()["id"]

        def jobs_by_label(invocation_id: str) -> dict[str, dict]:
            invocation = self.workflow_populator.get_invocation(invocation_id, step_details=True)
            by_label = {}
            for step in invocation["steps"]:
                if step["jobs"]:
                    assert len(step["jobs"]) == 1
                    job = self.dataset_populator.get_job_details(step["jobs"][0]["id"], full=True).json()
                    assert job["state"] == "ok", job
                    by_label[step["workflow_step_label"]] = job
            return by_label

        first_invocation_id = invoke(first_request)
        first_request_export = self.workflow_populator.invocation_to_request(first_invocation_id)

        # Rerun editing c, naming the first invocation as the source.
        second_request = copy.deepcopy(first_request_export)
        second_request["parameters"][c_index]["num_lines"] = "2"
        second_request["use_cached_job"] = True
        second_request["rerun_of_invocation_id"] = first_invocation_id
        second_request["rerun_step_index"] = int(c_index)
        second_invocation_id = invoke(second_request)

        first_jobs = jobs_by_label(first_invocation_id)
        second_jobs = jobs_by_label(second_invocation_id)
        for label in ("a", "b"):
            assert second_jobs[label]["copied_from_job_id"] == first_jobs[label]["id"], second_jobs[label]
        for label in ("c", "d"):
            assert not second_jobs[label]["copied_from_job_id"], second_jobs[label]

        # Run the workflow again plainly, creating newer original jobs equivalent to a and b.
        unrelated_invocation_id = invoke(first_request)
        unrelated_jobs = jobs_by_label(unrelated_invocation_id)
        for label in ("a", "b"):
            assert not unrelated_jobs[label]["copied_from_job_id"], unrelated_jobs[label]

        # Rerun the second invocation editing d.
        second_request_export = self.workflow_populator.invocation_to_request(second_invocation_id)
        third_request = copy.deepcopy(second_request_export)
        third_request["parameters"][d_index] = {
            "num_lines": "1",
            "seed_source|seed_source_selector": "set_seed",
            "seed_source|seed": "asdf",
        }
        third_request["rerun_of_invocation_id"] = second_invocation_id
        third_request["rerun_step_index"] = int(d_index)
        third_invocation_id = invoke(third_request)

        third_jobs = jobs_by_label(third_invocation_id)
        # a and b resolve to the first invocation's originals, not the newer unrelated ones
        for label in ("a", "b"):
            assert third_jobs[label]["copied_from_job_id"] == first_jobs[label]["id"], (
                label,
                third_jobs[label]["copied_from_job_id"],
                unrelated_jobs[label]["id"],
            )
        assert third_jobs["c"]["copied_from_job_id"] == second_jobs["c"]["id"], third_jobs["c"]
        assert not third_jobs["d"]["copied_from_job_id"], third_jobs["d"]

        # Lineage round-trips through the request export and is absent on a plain invocation.
        assert first_request_export.get("rerun_of_invocation_id") is None
        assert first_request_export.get("rerun_step_index") is None
        assert second_request_export["rerun_of_invocation_id"] == first_invocation_id
        assert second_request_export["rerun_step_index"] == int(c_index)
        third_request_export = self.workflow_populator.invocation_to_request(third_invocation_id)
        assert third_request_export["rerun_of_invocation_id"] == second_invocation_id
        assert third_request_export["rerun_step_index"] == int(d_index)

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_prefers_jobs_from_source_invocation_mapped_over(self, history_id: str):
        # Same as test_step_rerun_prefers_jobs_from_source_invocation, but every step is mapped
        # over a collection, so the source invocation's jobs live behind implicit collection jobs.
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  collection_input:
    type: data_collection_input
steps:
  a:
    tool_id: cat1
    in:
      input1: collection_input
  b:
    tool_id: cat1
    in:
      input1: a/out_file1
  c:
    tool_id: random_lines1
    state:
      num_lines: 3
      seed_source:
        seed_source_selector: set_seed
        seed: asdf
    in:
      input: b/out_file1
""")
        workflow = self.workflow_populator.download_workflow(workflow_id)
        order_index_by_label = {step["label"]: int(index) for index, step in workflow["steps"].items()}
        c_index = str(order_index_by_label["c"])

        hdca = self.dataset_collection_populator.create_list_in_history(
            history_id,
            contents=[("sample1", "1\n2\n3\n4\n5\n"), ("sample2", "6\n7\n8\n9\n10\n"), ("sample3", "a\nb\nc\nd\ne\n")],
        ).json()
        hdca = self.dataset_collection_populator.wait_for_fetched_collection(hdca)
        element_count = 3
        first_request = {
            "history": f"hist_id={history_id}",
            "inputs": json.dumps({"collection_input": self._ds_entry(hdca)}),
            "inputs_by": "name",
            "parameters_normalized": True,
            "parameters": json.dumps(
                {
                    c_index: {
                        "num_lines": "4",
                        "seed_source|seed_source_selector": "set_seed",
                        "seed_source|seed": "asdf",
                    }
                }
            ),
        }

        def invoke(request: dict) -> str:
            return self.workflow_populator.invoke_workflow_and_wait(workflow_id, request=request).json()["id"]

        def jobs_by_label(invocation_id: str) -> dict[str, list[dict]]:
            invocation = self.workflow_populator.get_invocation(invocation_id, step_details=True)
            by_label = {}
            for step in invocation["steps"]:
                if step["jobs"]:
                    assert len(step["jobs"]) == element_count, step
                    jobs = [self.dataset_populator.get_job_details(job["id"], full=True).json() for job in step["jobs"]]
                    for job in jobs:
                        assert job["state"] == "ok", job
                    by_label[step["workflow_step_label"]] = jobs
            return by_label

        first_invocation_id = invoke(first_request)
        # Run the workflow again plainly, creating newer original jobs equivalent to a and b.
        unrelated_invocation_id = invoke(first_request)

        rerun_request = self.workflow_populator.invocation_to_request(first_invocation_id)
        rerun_request["parameters"][c_index]["num_lines"] = "2"
        rerun_request["use_cached_job"] = True
        rerun_request["rerun_of_invocation_id"] = first_invocation_id
        rerun_request["rerun_step_index"] = int(c_index)
        rerun_invocation_id = invoke(rerun_request)

        first_jobs = jobs_by_label(first_invocation_id)
        unrelated_jobs = jobs_by_label(unrelated_invocation_id)
        rerun_jobs = jobs_by_label(rerun_invocation_id)
        for label in ("a", "b"):
            assert not any(job["copied_from_job_id"] for job in unrelated_jobs[label])
            copied_from = {job["copied_from_job_id"] for job in rerun_jobs[label]}
            assert copied_from == {job["id"] for job in first_jobs[label]}, (
                label,
                copied_from,
                {job["id"] for job in unrelated_jobs[label]},
            )
        assert not any(job["copied_from_job_id"] for job in rerun_jobs["c"]), rerun_jobs["c"]
        first_c_ids = {job["id"] for job in first_jobs["c"]}
        assert not first_c_ids & {job["id"] for job in rerun_jobs["c"]}
        for job in rerun_jobs["c"]:
            assert json.loads(job["params"]["num_lines"]) == "2"

    @skip_without_tool("cat1")
    def test_step_rerun_prefers_source_jobs_at_job_preparation(self, history_id: str):
        # When the scheduling-time cache lookup misses because input names differ, the job is
        # looked up again (names ignored) when it is prepared. That second lookup must prefer the
        # source invocation's jobs too, not the newest equivalent job.
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  the_input: data
steps:
  a:
    tool_id: cat1
    in:
      input1: the_input
  b:
    tool_id: cat1
    in:
      input1: a/out_file1
""")
        hda = self.dataset_populator.new_dataset(history_id, content="1\n2\n3\n", wait=True)
        first_request = {
            "history": f"hist_id={history_id}",
            "inputs": json.dumps({"the_input": {"src": "hda", "id": hda["id"]}}),
            "inputs_by": "name",
        }

        def invoke(request: dict) -> str:
            return self.workflow_populator.invoke_workflow_and_wait(workflow_id, request=request).json()["id"]

        def jobs_by_label(invocation_id: str) -> dict[str, dict]:
            invocation = self.workflow_populator.get_invocation(invocation_id, step_details=True)
            by_label = {}
            for step in invocation["steps"]:
                if step["jobs"]:
                    assert len(step["jobs"]) == 1
                    job = self.dataset_populator.get_job_details(step["jobs"][0]["id"], full=True).json()
                    assert job["state"] == "ok", job
                    by_label[step["workflow_step_label"]] = job
            return by_label

        first_invocation_id = invoke(first_request)
        # A newer plain run creates newer original jobs equivalent to a and b.
        unrelated_invocation_id = invoke(first_request)

        # A renamed copy of the input shares the dataset but fails the scheduling-time name match.
        copy_response = self._post(
            f"histories/{history_id}/contents",
            data={"content": hda["id"], "source": "hda", "type": "dataset"},
            json=True,
        )
        self._assert_status_code_is(copy_response, 200)
        renamed_copy = copy_response.json()
        self.dataset_populator.rename_dataset(renamed_copy["id"], "renamed input")

        rerun_request = {
            "history": f"hist_id={history_id}",
            "inputs": json.dumps({"the_input": {"src": "hda", "id": renamed_copy["id"]}}),
            "inputs_by": "name",
            "use_cached_job": True,
            "rerun_of_invocation_id": first_invocation_id,
        }
        rerun_invocation_id = invoke(rerun_request)

        first_jobs = jobs_by_label(first_invocation_id)
        unrelated_jobs = jobs_by_label(unrelated_invocation_id)
        rerun_jobs = jobs_by_label(rerun_invocation_id)
        for label in ("a", "b"):
            assert rerun_jobs[label]["copied_from_job_id"] == first_jobs[label]["id"], (
                label,
                rerun_jobs[label]["copied_from_job_id"],
                unrelated_jobs[label]["id"],
            )

    @skip_without_tool("cat1")
    @skip_without_tool("text_repeat")
    def test_step_rerun_edits_value_inside_repeat(self, history_id: str):
        # Run-time overrides cannot change a repeat's cardinality, so the rerun keeps the two
        # saved instances and only changes the text inside the second one.
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  the_input: data
steps:
  first_cat:
    tool_id: cat1
    in:
      input1: the_input
  repeat_text:
    tool_id: text_repeat
    state:
      the_repeat:
        - texttest: saved_a
        - texttest: saved_b
  downstream_cat:
    tool_id: cat1
    in:
      input1: repeat_text/out_file1
""")
        edited_step = self._step_rerun_order_indices(workflow_id)["repeat_text"]
        hda = self.dataset_populator.new_dataset(history_id, content="1\n2\n", wait=True)
        first_invocation_id = self._step_rerun_invoke(
            workflow_id,
            history_id,
            {"the_input": {"src": "hda", "id": hda["id"]}},
            {edited_step: {"the_repeat_0|texttest": "alpha", "the_repeat_1|texttest": "beta"}},
        )
        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"the_repeat_1|texttest": "gamma"}
        )

        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        second_jobs = self._step_rerun_single_jobs(second_invocation_id)
        self._assert_step_rerun_reuse(
            first_jobs, second_jobs, reused={"first_cat"}, recomputed={"repeat_text", "downstream_cat"}
        )
        # text_repeat writes to its working directory without from_work_dir, so its output is
        # empty; the job parameters are where the repeat values show up.
        for jobs, expected in ((first_jobs, ["alpha", "beta"]), (second_jobs, ["alpha", "gamma"])):
            the_repeat = json.loads(jobs["repeat_text"]["params"]["the_repeat"])
            assert [instance["texttest"] for instance in the_repeat] == expected, the_repeat

    @skip_without_tool("cat1")
    @skip_without_tool("section")
    def test_step_rerun_edits_section_parameter(self, history_id: str):
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  the_input: data
steps:
  first_cat:
    tool_id: cat1
    in:
      input1: the_input
  section_step:
    tool_id: section
    state:
      int:
        inttest: 3
      float:
        floattest: 1.5
  downstream_cat:
    tool_id: cat1
    in:
      input1: section_step/out_file1
""")
        edited_step = self._step_rerun_order_indices(workflow_id)["section_step"]
        hda = self.dataset_populator.new_dataset(history_id, content="1\n2\n", wait=True)
        original_step_parameters = {"int|inttest": "5", "float|floattest": "2.5"}
        first_invocation_id = self._step_rerun_invoke(
            workflow_id,
            history_id,
            {"the_input": {"src": "hda", "id": hda["id"]}},
            {edited_step: original_step_parameters},
        )
        request = self.workflow_populator.invocation_to_request(first_invocation_id)
        assert request["parameters"] == {edited_step: original_step_parameters}
        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"int|inttest": "7"}
        )

        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        second_jobs = self._step_rerun_single_jobs(second_invocation_id)
        self._assert_step_rerun_reuse(
            first_jobs, second_jobs, reused={"first_cat"}, recomputed={"section_step", "downstream_cat"}
        )
        for jobs, expected in ((first_jobs, "5\n2.5\n"), (second_jobs, "7\n2.5\n")):
            content = self.dataset_populator.get_history_dataset_content(
                history_id, dataset_id=jobs["downstream_cat"]["outputs"]["out_file1"]["id"]
            )
            assert content == expected

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_mapped_over_step_reuses_per_element(self, history_id: str):
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  the_collection:
    type: data_collection_input
    collection_type: list
steps:
  first_cat:
    tool_id: cat1
    in:
      input1: the_collection
  random_lines:
    tool_id: random_lines1
    state:
      num_lines: 3
      seed_source:
        seed_source_selector: set_seed
        seed: asdf
    in:
      input: first_cat/out_file1
  downstream_cat:
    tool_id: cat1
    in:
      input1: random_lines/out_file1
""")
        edited_step = self._step_rerun_order_indices(workflow_id)["random_lines"]
        hdca = self.dataset_collection_populator.create_list_in_history(
            history_id, contents=[("el1", "1\n2\n3\n4\n5\n6\n"), ("el2", "a\nb\nc\nd\ne\nf\n")]
        ).json()
        hdca = self.dataset_collection_populator.wait_for_fetched_collection(hdca)
        first_invocation_id = self._step_rerun_invoke(
            workflow_id,
            history_id,
            {"the_collection": self._ds_entry(hdca)},
            {edited_step: dict(STEP_RERUN_RANDOM_LINES_PARAMETERS)},
        )
        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"num_lines": "2"}
        )

        first_jobs = self._step_rerun_jobs(first_invocation_id)
        second_jobs = self._step_rerun_jobs(second_invocation_id)
        assert set(first_jobs) == set(second_jobs) == {"first_cat", "random_lines", "downstream_cat"}
        for label, jobs in first_jobs.items():
            assert len(jobs) == len(second_jobs[label]) == 2, label
            for job in jobs:
                assert not job["copied_from_job_id"], job
        # every element of the step upstream of the edit reuses its own first-run job
        assert sorted(job["copied_from_job_id"] for job in second_jobs["first_cat"]) == sorted(
            job["id"] for job in first_jobs["first_cat"]
        )
        # every element of the edited step and its downstream is a new job
        for label in ("random_lines", "downstream_cat"):
            for job in second_jobs[label]:
                assert not job["copied_from_job_id"], job
        for job in second_jobs["random_lines"]:
            assert json.loads(job["params"]["num_lines"]) == "2"

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_after_upstream_output_purged(self, history_id: str):
        workflow_id, edited_step, first_invocation_id = self._step_rerun_chain_setup(history_id)
        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        first_cat_output = first_jobs["first_cat"]["outputs"]["out_file1"]["id"]
        self.dataset_populator.delete_dataset(history_id, first_cat_output, purge=True, wait_for_purge=True)

        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"num_lines": "2"}
        )
        second_jobs = self._step_rerun_single_jobs(second_invocation_id)
        self._assert_step_rerun_reuse(
            first_jobs,
            second_jobs,
            reused=set(),
            recomputed={"first_cat", "second_cat", "sibling_lines", "random_lines", "downstream_cat"},
        )

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_into_new_history(self, history_id: str):
        workflow_id, edited_step, first_invocation_id = self._step_rerun_chain_setup(history_id)
        new_history_id = self.dataset_populator.new_history()
        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"num_lines": "2"}, history_id=new_history_id
        )
        assert self.workflow_populator.get_invocation(second_invocation_id)["history_id"] == new_history_id

        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        second_jobs = self._step_rerun_single_jobs(second_invocation_id)
        self._assert_step_rerun_reuse(
            first_jobs,
            second_jobs,
            reused={"first_cat", "second_cat", "sibling_lines"},
            recomputed={"random_lines", "downstream_cat"},
        )
        new_history_contents = {item["id"] for item in self.dataset_populator.get_history_contents(new_history_id)}
        for label, job in second_jobs.items():
            assert job["history_id"] == new_history_id, job
            assert job["outputs"]["out_file1"]["id"] in new_history_contents, label

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_of_a_rerun_reuses_original_jobs(self, history_id: str):
        workflow_id, edited_step, first_invocation_id = self._step_rerun_chain_setup(history_id)
        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"num_lines": "2"}
        )
        third_invocation_id = self._step_rerun_from_request(
            second_invocation_id, workflow_id, edited_step, {"num_lines": "3"}
        )

        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        third_jobs = self._step_rerun_single_jobs(third_invocation_id)
        # Copied jobs point at their originals, so the third invocation's unchanged steps should
        # still trace back to the first invocation's jobs.
        self._assert_step_rerun_reuse(
            first_jobs,
            third_jobs,
            reused={"first_cat", "second_cat", "sibling_lines"},
            recomputed={"random_lines", "downstream_cat"},
        )
        assert json.loads(third_jobs["random_lines"]["params"]["num_lines"]) == "3"

    @pytest.mark.xfail(
        strict=True,
        reason="JobSearch.by_tool_input takes the newest equivalent job, so a newer job outside the source invocation breaks the reuse chain downstream of it.",
    )
    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_with_newer_equivalent_job_outside_invocation(self, history_id: str):
        workflow_id, edited_step, first_invocation_id = self._step_rerun_chain_setup(history_id)
        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        # Run first_cat's tool by hand on the same input: an equivalent job, newer than the
        # invocation's, whose output was never fed to second_cat or sibling_lines.
        the_input = first_jobs["first_cat"]["inputs"]["input1"]
        run = self.dataset_populator.run_tool("cat1", {"input1": the_input}, history_id)
        self.dataset_populator.wait_for_job(run["jobs"][0]["id"], assert_ok=True)

        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id, workflow_id, edited_step, {"num_lines": "2"}
        )
        second_jobs = self._step_rerun_single_jobs(second_invocation_id)
        self._assert_step_rerun_reuse(
            first_jobs,
            second_jobs,
            reused={"first_cat", "second_cat", "sibling_lines"},
            recomputed={"random_lines", "downstream_cat"},
        )

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_with_newer_equivalent_job_outside_invocation_prefers_source(self, history_id: str):
        # Same setup as the xfail above, but the rerun names its source invocation, so the job
        # cache prefers that invocation's jobs over the newer hand-run one and the chain holds.
        workflow_id, edited_step, first_invocation_id = self._step_rerun_chain_setup(history_id)
        first_jobs = self._step_rerun_single_jobs(first_invocation_id)
        the_input = first_jobs["first_cat"]["inputs"]["input1"]
        run = self.dataset_populator.run_tool("cat1", {"input1": the_input}, history_id)
        self.dataset_populator.wait_for_job(run["jobs"][0]["id"], assert_ok=True)

        second_invocation_id = self._step_rerun_from_request(
            first_invocation_id,
            workflow_id,
            edited_step,
            {"num_lines": "2"},
            rerun_of_invocation_id=first_invocation_id,
        )
        second_jobs = self._step_rerun_single_jobs(second_invocation_id)
        self._assert_step_rerun_reuse(
            first_jobs,
            second_jobs,
            reused={"first_cat", "second_cat", "sibling_lines"},
            recomputed={"random_lines", "downstream_cat"},
        )

    @skip_without_tool("cat1")
    @skip_without_tool("random_lines1")
    def test_step_rerun_prefers_the_source_steps_own_job(self, history_id: str):
        # Two sibling steps run the same tool on the same input, so their jobs are interchangeable
        # to the cache. Preferring the whole source invocation still lets the newer sibling's job
        # win for both, which hands the branch under the older sibling a different dataset row.
        workflow_id = self.workflow_populator.upload_yaml_workflow("""
class: GalaxyWorkflow
inputs:
  the_input: data
steps:
  a1:
    tool_id: cat1
    in:
      input1: the_input
  a2:
    tool_id: cat1
    in:
      input1: the_input
  b1:
    tool_id: cat1
    in:
      input1: a1/out_file1
  b2:
    tool_id: cat1
    in:
      input1: a2/out_file1
  c:
    tool_id: random_lines1
    state:
      num_lines: 3
      seed_source:
        seed_source_selector: set_seed
        seed: asdf
    in:
      input: b2/out_file1
""")
        workflow = self.workflow_populator.download_workflow(workflow_id)
        order_index_by_label = {step["label"]: int(index) for index, step in workflow["steps"].items()}
        c_index = str(order_index_by_label["c"])

        hda = self.dataset_populator.new_dataset(history_id, content="1\n2\n3\n4\n5\n6\n", wait=True)
        first_request = {
            "history": f"hist_id={history_id}",
            "inputs": json.dumps({"the_input": {"src": "hda", "id": hda["id"]}}),
            "inputs_by": "name",
        }

        def invoke(request: dict) -> str:
            return self.workflow_populator.invoke_workflow_and_wait(workflow_id, request=request).json()["id"]

        def jobs_by_label(invocation_id: str) -> dict[str, dict]:
            invocation = self.workflow_populator.get_invocation(invocation_id, step_details=True)
            by_label = {}
            for step in invocation["steps"]:
                if step["jobs"]:
                    assert len(step["jobs"]) == 1
                    job = self.dataset_populator.get_job_details(step["jobs"][0]["id"], full=True).json()
                    assert job["state"] == "ok", job
                    by_label[step["workflow_step_label"]] = job
            return by_label

        first_invocation_id = invoke(first_request)
        first_jobs = jobs_by_label(first_invocation_id)
        assert first_jobs["a1"]["id"] != first_jobs["a2"]["id"]

        rerun_request = self.workflow_populator.invocation_to_request(first_invocation_id)
        rerun_request["parameters"] = {c_index: {"num_lines": "2"}}
        rerun_request["use_cached_job"] = True
        rerun_request["rerun_of_invocation_id"] = first_invocation_id
        rerun_request["rerun_step_index"] = int(c_index)
        rerun_invocation_id = invoke(rerun_request)

        rerun_jobs = jobs_by_label(rerun_invocation_id)
        for label in ("a1", "a2", "b1", "b2"):
            assert rerun_jobs[label]["copied_from_job_id"] == first_jobs[label]["id"], (
                label,
                rerun_jobs[label]["copied_from_job_id"],
                {other: first_jobs[other]["id"] for other in ("a1", "a2", "b1", "b2")},
            )
        assert not rerun_jobs["c"]["copied_from_job_id"], rerun_jobs["c"]
