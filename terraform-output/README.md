# `uShip/actions/terraform-output`

This action assists in neatly formatting and presenting terraform plan, as well as other step output. Assumes you're using the `hashicorp/setup-terraform` action which wraps stdout and stderr into neat outputs.

```yml
      - uses: uShip/actions/terraform-output@v1
        with:
          # JSON-ified step outcomes
          steps: ${{ toJSON(steps) }} # required

          # Whether or not to parse the plan step as json.
          # If enabled, assumes plan -json available at plan.log
          # default: "false"
          json: ""
  
          # Step ids of various steps.
          # Change if you're using non-default step ids
          # for terraform steps.
          fmt: fmt             # default
          init: init           # default
          validate: validate   # default
          plan: plan           # default
          show: show           # default

          # Whether or not to fail if any of the previous
          # steps failed.
          fail-on-error: "true" # default

          # The github token to use
          token: ${{ github.token }} # default

          # A unique id to differentiate between multiple terraform-output actions
          # Useful if a single pr may run multiple terraform plans
          context: ""
          
          # The working directory to execute action steps in, if this is a multi-workspace repository
          working-directory: ""
          
          # Whether or not to "auto-approve" the Pull Request if a plan is clean. Useful for
          # auto-merging dependencies
          auto-approve: false
```

<details><summary><b>Example Usage</b></summary>

```yml
      - uses: actions/checkout@v2
      - uses: hashicorp/setup-terraform@v1
        with:
          # Necessary otherwise the output of some steps
          # can cause the outputs of a given step to be too
          # large to process correctly.
          terraform_wrapper: false

      - name: Terraform fmt
        id: fmt
        run: terraform fmt -check

      - name: Terraform Init
        id: init
        run: terraform init

      - name: Terraform Validate
        id: validate
        run: terraform validate

      - name: Terraform Plan
        id: plan
        run: terraform plan -json -out=tfplan | tee plan.log

      - name: Terraform Show
        id: show
        run: terraform show tfplan | tee show.log

      - uses: uShip/actions/terraform-output@v1
        if: ${{ always() }}
        with:
          steps: ${{ toJSON(steps) }}
          json: true
```
</details>
